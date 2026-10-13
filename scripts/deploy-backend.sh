#!/usr/bin/env bash
# Deploys the Catalyst function with its secrets injected ONLY while the deploy
# runs. The secrets live outside the repo (default: ~/robobench-secrets), are
# written into the function's catalyst-config.json for the deploy, and that file
# is put back exactly as it was afterwards, so the secrets never reach git.
#
# Usage (from anywhere):   bash scripts/deploy-backend.sh
# Secrets folder must hold: serviceAccountKey.json, azureConfig.json, workerConfig.json
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNC="$ROOT/backend/functions/submit_experiment"
CONFIG="$FUNC/catalyst-config.json"
BACKUP="$CONFIG.orig"
SECRETS="${ROBOBENCH_SECRETS:-$HOME/robobench-secrets}"

[ -f "$CONFIG" ] || { echo "Missing $CONFIG"; exit 1; }

if [ -f "$BACKUP" ]; then
  echo "Found $BACKUP: a previous deploy did not finish cleanly."
  echo "Check that $CONFIG contains no secrets, then restore the original with:"
  echo "  mv \"$BACKUP\" \"$CONFIG\""
  exit 1
fi

for f in serviceAccountKey.json azureConfig.json workerConfig.json; do
  [ -f "$SECRETS/$f" ] || { echo "Missing $SECRETS/$f"; exit 1; }
done

cp "$CONFIG" "$BACKUP"
restore() {
  if [ -f "$BACKUP" ]; then
    mv "$BACKUP" "$CONFIG"
    echo "Restored catalyst-config.json (secrets removed)."
  fi
}
trap restore EXIT
trap 'restore; exit 130' INT TERM

SECRETS_DIR="$SECRETS" CONFIG_PATH="$CONFIG" node -e '
const fs = require("fs");
const dir = process.env.SECRETS_DIR;
const file = process.env.CONFIG_PATH;
const readJson = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, "utf8"));

const vars = {
  // compact JSON, base64-encoded, so quoting and newlines cannot break it
  FIREBASE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(readJson("serviceAccountKey.json"))).toString("base64"),
  AZURE_STORAGE_CONNECTION_STRING: readJson("azureConfig.json").connectionString,
  WORKER_SECRET: readJson("workerConfig.json").secret,
};
for (const [k, v] of Object.entries(vars)) {
  if (typeof v !== "string" || !v) throw new Error(k + " is empty in " + dir);
}

const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
const where = cfg.deployment && typeof cfg.deployment === "object" ? cfg.deployment : cfg;
where.env_variables = { ...(where.env_variables || {}), ...vars };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log("Injected " + Object.keys(vars).length + " variables into " + (where === cfg ? "env_variables" : "deployment.env_variables"));
'

( cd "$ROOT/backend" && catalyst deploy --only functions )
