"use strict";

const express = require("express");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccountKey.json");

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const ALLOWED_ALGORITHMS = ["PPO", "A2C", "DQN"];

const app = express();
app.use(express.json({ limit: "100kb" }));

// CORS so the browser app (localhost:5173) can call this function.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Returns { error } or { data } with a cleaned experiment object.
function validate(body) {
  const b = body || {};

  if (typeof b.projectId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(b.projectId)) {
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

app.post(["/", "/submit"], async (req, res) => {
  // 1. Who is calling? Verify the Firebase ID token.
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing login token" });

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired login token" });
  }

  // 2. Is the data valid?
  const { error, data } = validate(req.body);
  if (error) return res.status(400).json({ error });

  try {
    // 3. Does the project exist, and does it belong to this user?
    const projectSnap = await db.collection("projects").doc(data.projectId).get();
    if (!projectSnap.exists) {
      return res.status(404).json({ error: "Project not found" });
    }
    const project = projectSnap.data();
    if (project.ownerId !== decoded.uid) {
      return res.status(403).json({ error: "You can only submit to your own projects" });
    }
    if (project.environment !== data.environment) {
      return res.status(400).json({
        error: `environment must match the project (${project.environment})`,
      });
    }

    // 4. Save. ownerId comes from the verified token, never from the client.
    const ref = await db.collection("experiments").add({
      ...data,
      ownerId: decoded.uid,
      status: "submitted",
      createdAt: FieldValue.serverTimestamp(),
    });
    return res.status(201).json({ id: ref.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not save experiment" });
  }
});

module.exports = app;
