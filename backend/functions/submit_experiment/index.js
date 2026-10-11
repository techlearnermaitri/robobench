"use strict";

const crypto = require("crypto");
const express = require("express");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccountKey.json");
const azure = require("./azure");

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const ALLOWED_ALGORITHMS = ["PPO", "A2C", "DQN"];
const ALLOWED_EXTENSIONS = ["zip", "png", "csv", "json", "txt", "mp4"];
const ARTIFACT_KINDS = ["model", "plot"];
const MAX_CURVE_POINTS = 200;
const MAX_SUBMISSIONS_PER_USER = 50; // per project, for people who don't own it
const UPLOAD_MINUTES = 15;
const DOWNLOAD_MINUTES = 10;

const app = express();
// text/plain is accepted too: browsers send it without a CORS preflight,
// which Catalyst's gateway would otherwise answer without calling this function.
app.use(express.json({ limit: "100kb", type: ["application/json", "text/plain"] }));

// CORS so the browser app (localhost:5173) can call this function.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Firebase-Token");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Verifies the Firebase ID token. Sends the error response itself and
// returns null when the caller is not logged in.
async function authenticate(req, res) {
  // Catalyst's gateway tries to validate any "Authorization: Bearer" header as
  // its own OAuth token, so the Firebase token travels in a custom header.
  const header = req.headers.authorization || "";
  const token =
    (req.body && req.body.idToken) ||
    req.headers["x-firebase-token"] ||
    (header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) {
    res.status(401).json({ error: "Missing login token" });
    return null;
  }
  try {
    return await getAuth().verifyIdToken(token);
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired login token" });
    return null;
  }
}

function validProjectId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

// Loads a project and checks that the caller may submit to it: the owner
// always can, everyone else only if the owner opened the project.
// Returns { project, isOwner } or { status, error }.
async function loadSubmittableProject(projectId, uid) {
  const snap = await db.collection("projects").doc(projectId).get();
  if (!snap.exists) return { status: 404, error: "Project not found" };
  const project = snap.data();
  const isOwner = project.ownerId === uid;
  if (!isOwner && project.submissions !== "anyone") {
    return { status: 403, error: "This project only accepts submissions from its owner" };
  }
  return { project, isOwner };
}

// The public name shown next to a result. It comes from the verified login
// token, so a client cannot choose someone else's name.
function displayNameFrom(decoded) {
  const raw = typeof decoded.name === "string" ? decoded.name : "";
  const clean = raw.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40).trim();
  return clean || `user-${decoded.uid.slice(0, 6)}`;
}

// Returns { error } or { data } with a cleaned experiment object.
function validate(body) {
  const b = body || {};

  if (!validProjectId(b.projectId)) {
    return { error: "projectId is missing or invalid" };
  }
  if (!ALLOWED_ALGORITHMS.includes(b.algorithm)) {
    return { error: `algorithm must be one of ${ALLOWED_ALGORITHMS.join(", ")}` };
  }
  if (typeof b.environment !== "string" || !b.environment.trim() ||
      b.environment.length > 64) {
    return { error: "environment must be a non-empty string (max 64 chars)" };
  }
  if (!isNum(b.meanReward)) return { error: "meanReward must be a number" };
  if (!isNum(b.stdReward) || b.stdReward < 0) {
    return { error: "stdReward must be a number >= 0" };
  }
  if (!Number.isInteger(b.episodes) || b.episodes < 1 || b.episodes > 100000) {
    return { error: "episodes must be an integer between 1 and 100000" };
  }
  if (!isNum(b.trainingTime) || b.trainingTime <= 0) {
    return { error: "trainingTime must be a number > 0" };
  }

  return {
    data: {
      projectId: b.projectId,
      algorithm: b.algorithm,
      environment: b.environment.trim(),
      meanReward: b.meanReward,
      stdReward: b.stdReward,
      episodes: b.episodes,
      trainingTime: b.trainingTime,
    },
  };
}

// A small training curve used by the comparison view. Returns { error } or { curve }.
function cleanCurve(curve) {
  if (typeof curve !== "object" || curve === null || Array.isArray(curve)) {
    return { error: "curve must be an object" };
  }
  const { steps, rewards } = curve;
  if (!Array.isArray(steps) || !Array.isArray(rewards) || steps.length !== rewards.length) {
    return { error: "curve.steps and curve.rewards must be arrays of the same length" };
  }
  if (steps.length < 2 || steps.length > MAX_CURVE_POINTS) {
    return { error: `curve must have between 2 and ${MAX_CURVE_POINTS} points` };
  }
  for (let i = 0; i < steps.length; i++) {
    if (!isNum(steps[i]) || !isNum(rewards[i])) {
      return { error: "curve values must be numbers" };
    }
    if (steps[i] < 0 || steps[i] > 1e10 || Math.abs(rewards[i]) > 1e9) {
      return { error: "curve values are out of range" };
    }
    if (i > 0 && steps[i] <= steps[i - 1]) {
      return { error: "curve.steps must be increasing" };
    }
  }
  return {
    curve: {
      steps: steps.map((v) => Math.round(v)),
      rewards: rewards.map((v) => Math.round(v * 100) / 100),
    },
  };
}

// Artifact paths must be inside this user's own upload folder for this
// project, and the file must really exist in Azure.
async function cleanArtifacts(artifacts, projectId, uid) {
  if (artifacts === undefined || artifacts === null) return { artifacts: {} };
  if (typeof artifacts !== "object" || Array.isArray(artifacts)) {
    return { error: "artifacts must be an object" };
  }

  const prefix = `${projectId}/${uid}/`;
  const clean = {};
  for (const kind of Object.keys(artifacts)) {
    if (!ARTIFACT_KINDS.includes(kind)) {
      return { error: `unknown artifact type: ${kind}` };
    }
    const path = artifacts[kind];
    if (typeof path !== "string" || path.length > 300 ||
        !path.startsWith(prefix) || path.includes("..")) {
      return { error: `invalid ${kind} path` };
    }
    if (!(await azure.blobExists(path))) {
      return { error: `${kind} file was not found in storage` };
    }
    clean[kind] = path;
  }
  return { artifacts: clean };
}

// ---- POST /  : submit an experiment ----
app.post(["/", "/submit"], async (req, res) => {
  const decoded = await authenticate(req, res);
  if (!decoded) return;

  const { error, data } = validate(req.body);
  if (error) return res.status(400).json({ error });

  let curve = null;
  if (req.body.curve !== undefined && req.body.curve !== null) {
    const checked = cleanCurve(req.body.curve);
    if (checked.error) return res.status(400).json({ error: checked.error });
    curve = checked.curve;
  }

  try {
    const owned = await loadSubmittableProject(data.projectId, decoded.uid);
    if (owned.error) return res.status(owned.status).json({ error: owned.error });
    if (owned.project.environment !== data.environment) {
      return res.status(400).json({
        error: `environment must match the project (${owned.project.environment})`,
      });
    }

    if (!owned.isOwner) {
      const mine = await db
        .collection("experiments")
        .where("projectId", "==", data.projectId)
        .where("ownerId", "==", decoded.uid)
        .limit(MAX_SUBMISSIONS_PER_USER)
        .get();
      if (mine.size >= MAX_SUBMISSIONS_PER_USER) {
        return res.status(429).json({
          error: `Limit of ${MAX_SUBMISSIONS_PER_USER} submissions per person reached for this project`,
        });
      }
    }

    let artifacts = {};
    if (req.body.artifacts) {
      if (!azure.isConfigured()) {
        return res.status(500).json({ error: "Azure storage is not configured" });
      }
      const result = await cleanArtifacts(req.body.artifacts, data.projectId, decoded.uid);
      if (result.error) return res.status(400).json({ error: result.error });
      artifacts = result.artifacts;
    }

    const ref = await db.collection("experiments").add({
      ...data,
      artifacts,
      ...(curve ? { curve } : {}),
      ownerId: decoded.uid,
      ownerName: displayNameFrom(decoded),
      status: "submitted",
      createdAt: FieldValue.serverTimestamp(),
    });
    return res.status(201).json({ id: ref.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not save experiment" });
  }
});

// ---- POST /upload-url : short-lived link to upload ONE file ----
app.post("/upload-url", async (req, res) => {
  const decoded = await authenticate(req, res);
  if (!decoded) return;

  const { projectId, filename } = req.body || {};
  if (!validProjectId(projectId)) {
    return res.status(400).json({ error: "projectId is missing or invalid" });
  }
  if (typeof filename !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(filename)) {
    return res.status(400).json({ error: "filename may only use letters, numbers, . _ -" });
  }
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return res.status(400).json({
      error: `file type not allowed (use ${ALLOWED_EXTENSIONS.join(", ")})`,
    });
  }
  if (!azure.isConfigured()) {
    return res.status(500).json({ error: "Azure storage is not configured" });
  }

  try {
    const owned = await loadSubmittableProject(projectId, decoded.uid);
    if (owned.error) return res.status(owned.status).json({ error: owned.error });

    const blobPath = `${projectId}/${decoded.uid}/${crypto.randomUUID()}/${filename}`;
    const uploadUrl = azure.makeSasUrl(blobPath, "write", UPLOAD_MINUTES);
    return res.json({ uploadUrl, blobPath, expiresInMinutes: UPLOAD_MINUTES });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not create upload link" });
  }
});

// ---- POST /download-url : short-lived link to download one artifact ----
app.post("/download-url", async (req, res) => {
  const decoded = await authenticate(req, res);
  if (!decoded) return;

  const { experimentId, kind } = req.body || {};
  if (typeof experimentId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(experimentId)) {
    return res.status(400).json({ error: "experimentId is missing or invalid" });
  }
  if (!ARTIFACT_KINDS.includes(kind)) {
    return res.status(400).json({ error: "kind must be model or plot" });
  }
  if (!azure.isConfigured()) {
    return res.status(500).json({ error: "Azure storage is not configured" });
  }

  try {
    const snap = await db.collection("experiments").doc(experimentId).get();
    if (!snap.exists) return res.status(404).json({ error: "Experiment not found" });

    const path = (snap.data().artifacts || {})[kind];
    if (!path) return res.status(404).json({ error: `No ${kind} file for this experiment` });

    return res.json({ url: azure.makeSasUrl(path, "read", DOWNLOAD_MINUTES) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not create download link" });
  }
});

// ---- Verification worker endpoints (/worker/next, /worker/result) ----
require("./worker")(app, { db, FieldValue, azure });

module.exports = app;