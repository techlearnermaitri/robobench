"use strict";

// Endpoints for the verification worker (a container job, not a browser).
//   POST /worker/next   -> claims one experiment and returns a model download link
//   POST /worker/result -> receives the re-measured score and sets the verdict
// Both require the X-Worker-Secret header. The worker never gets Firebase or
// Azure keys: it can only ask for work and report results through this API.

const crypto = require("crypto");
const { decide } = require("./verdict");

const VERIFIABLE_ENVIRONMENTS = ["CartPole-v1"];
const VERIFY_EPISODES = 100;
const LEASE_MS = 15 * 60 * 1000; // how long a claimed job stays reserved
const MAX_ATTEMPTS = 3;          // a model that keeps crashing the worker is rejected
const MODEL_URL_MINUTES = 20;

function loadSecret() {
  let secret = process.env.WORKER_SECRET;
  if (!secret) {
    try {
      secret = require("./workerConfig.json").secret;
    } catch (e) {
      secret = null;
    }
  }
  return secret || null;
}

// "env", "file" or "missing": where the worker secret comes from.
function secretSource() {
  if (process.env.WORKER_SECRET) return "env";
  try {
    return require("./workerConfig.json").secret ? "file" : "missing";
  } catch (e) {
    return "missing";
  }
}

function secretMatches(provided, expected) {
  if (typeof provided !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

module.exports = function registerWorkerRoutes(app, { db, FieldValue, azure }) {
  function guard(req, res) {
    const expected = loadSecret();
    if (!expected) {
      res.status(500).json({ error: "Worker access is not configured" });
      return false;
    }
    if (!secretMatches(req.headers["x-worker-secret"], expected)) {
      res.status(401).json({ error: "Invalid worker secret" });
      return false;
    }
    return true;
  }

  // Finds the next experiment to verify and reserves it. Returns null if none.
  async function claimNext() {
    const [submitted, verifying] = await Promise.all([
      db.collection("experiments").where("status", "==", "submitted").limit(25).get(),
      db.collection("experiments").where("status", "==", "verifying").limit(25).get(),
    ]);

    const now = Date.now();
    const candidates = [
      ...submitted.docs,
      // jobs whose worker vanished: the lease ran out, so they can be retried
      ...verifying.docs.filter((d) => ((d.data().verification || {}).leaseUntil || 0) < now),
    ];

    for (const doc of candidates) {
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(doc.ref);
        if (!snap.exists) return null;
        const data = snap.data();
        const prev = data.verification || {};

        const claimable =
          data.status === "submitted" ||
          (data.status === "verifying" && (prev.leaseUntil || 0) < Date.now());
        if (!claimable) return null;

        const modelPath = (data.artifacts || {}).model;
        if (!modelPath) return null; // nothing to verify; stays "submitted"

        if (!VERIFIABLE_ENVIRONMENTS.includes(data.environment)) {
          tx.update(snap.ref, {
            status: "unsupported",
            verification: {
              status: "unsupported",
              note: `No verifier for ${data.environment}`,
              checkedAt: FieldValue.serverTimestamp(),
            },
          });
          return null;
        }

        const attempts = (prev.attempts || 0) + 1;
        if (attempts > MAX_ATTEMPTS) {
          tx.update(snap.ref, {
            status: "rejected",
            verification: {
              status: "rejected",
              attempts: prev.attempts || 0,
              note: "Verification failed repeatedly",
              checkedAt: FieldValue.serverTimestamp(),
            },
          });
          return null;
        }

        tx.update(snap.ref, {
          status: "verifying",
          verification: {
            status: "verifying",
            attempts,
            leaseUntil: Date.now() + LEASE_MS,
            startedAt: FieldValue.serverTimestamp(),
          },
        });
        return { id: snap.id, data, modelPath };
      });

      if (claimed) return claimed;
    }
    return null;
  }

  app.post("/worker/next", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const claimed = await claimNext();
      if (!claimed) return res.json({ job: null });

      return res.json({
        job: {
          experimentId: claimed.id,
          algorithm: claimed.data.algorithm,
          environment: claimed.data.environment,
          episodes: VERIFY_EPISODES,
          modelUrl: azure.makeSasUrl(claimed.modelPath, "read", MODEL_URL_MINUTES),
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Could not fetch work" });
    }
  });

  app.post("/worker/result", async (req, res) => {
    if (!guard(req, res)) return;

    const b = req.body || {};
    if (typeof b.experimentId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(b.experimentId)) {
      return res.status(400).json({ error: "experimentId is missing or invalid" });
    }

    try {
      const ref = db.collection("experiments").doc(b.experimentId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Experiment not found" });

      const data = snap.data();
      if (data.status !== "verifying") {
        return res.status(409).json({ error: `Experiment is ${data.status}, not verifying` });
      }
      const attempts = (data.verification || {}).attempts || 1;

      // The worker could not load or run the model: the claim is unsupported.
      if (typeof b.failure === "string") {
        await ref.update({
          status: "rejected",
          verification: {
            status: "rejected",
            attempts,
            note: `Model could not be evaluated: ${b.failure.slice(0, 300)}`,
            checkedAt: FieldValue.serverTimestamp(),
          },
        });
        return res.json({ status: "rejected" });
      }

      if (!isNum(b.measuredMean) || !isNum(b.measuredStd) || b.measuredStd < 0 ||
          !Number.isInteger(b.episodes) || b.episodes < 1) {
        return res.status(400).json({ error: "measuredMean, measuredStd and episodes are required numbers" });
      }

      const verdict = decide({
        claimedMean: data.meanReward,
        claimedStd: data.stdReward,
        measuredMean: b.measuredMean,
      });

      await ref.update({
        status: verdict.status,
        verification: {
          status: verdict.status,
          attempts,
          measuredMean: b.measuredMean,
          measuredStd: b.measuredStd,
          episodes: b.episodes,
          tolerance: verdict.tolerance,
          note:
            verdict.status === "validated"
              ? "Score confirmed by re-evaluation"
              : `Claimed ${data.meanReward}, re-measured ${b.measuredMean.toFixed(1)}`,
          checkedAt: FieldValue.serverTimestamp(),
        },
      });
      return res.json({ status: verdict.status });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Could not save result" });
    }
  });
};

module.exports.secretSource = secretSource;