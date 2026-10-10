"""RoboBench Python client: log in with Firebase, upload files to Azure and
submit results through the Catalyst API.

Reads settings from client/.env:
    FIREBASE_API_KEY=...        (same value as VITE_FIREBASE_API_KEY)
    ROBOBENCH_EMAIL=...
    ROBOBENCH_PASSWORD=...
    ROBOBENCH_API_URL=http://localhost:3000/server/submit_experiment/
    ROBOBENCH_PROJECT_ID=...    (optional default; copy it from the project page)
"""

import os
import time

import requests
from dotenv import load_dotenv

load_dotenv()

_token = {"value": None, "expires": 0.0}


def _env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing {name}. Add it to client/.env")
    return value


def _api(path=""):
    return _env("ROBOBENCH_API_URL").rstrip("/") + "/" + path


def _error_message(res):
    try:
        return res.json().get("error", res.text)
    except ValueError:
        return res.text


def login():
    """Sign in with email/password and return a Firebase ID token (cached)."""
    if _token["value"] and time.time() < _token["expires"]:
        return _token["value"]

    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={_env('FIREBASE_API_KEY')}"
    )
    res = requests.post(
        url,
        json={
            "email": _env("ROBOBENCH_EMAIL"),
            "password": _env("ROBOBENCH_PASSWORD"),
            "returnSecureToken": True,
        },
        timeout=30,
    )
    if not res.ok:
        msg = res.json().get("error", {}).get("message", res.text)
        raise SystemExit(f"Login failed: {msg}")

    _token["value"] = res.json()["idToken"]
    _token["expires"] = time.time() + 50 * 60  # tokens last 60 minutes
    return _token["value"]


def upload_file(project_id, file_path):
    """Upload one file to Azure Blob Storage. Returns its blob path."""
    if not os.path.isfile(file_path):
        raise SystemExit(f"File not found: {file_path}")

    headers = {"Authorization": f"Bearer {login()}"}
    res = requests.post(
        _api("upload-url"),
        headers=headers,
        json={"projectId": project_id, "filename": os.path.basename(file_path)},
        timeout=30,
    )
    if not res.ok:
        raise SystemExit(f"Upload link failed ({res.status_code}): {_error_message(res)}")
    info = res.json()

    with open(file_path, "rb") as f:
        put = requests.put(
            info["uploadUrl"],
            data=f,
            headers={"x-ms-blob-type": "BlockBlob"},
            timeout=600,
        )
    if put.status_code not in (200, 201):
        raise SystemExit(f"Azure upload failed ({put.status_code}): {put.text[:300]}")
    return info["blobPath"]


def submit(project_id, algorithm, environment, mean_reward, std_reward,
           episodes, training_time, artifacts=None):
    """Send one experiment to the Catalyst API. Returns the new experiment id.

    artifacts: optional dict like {"model": blob_path, "plot": blob_path}
    """
    payload = {
        "projectId": project_id,
        "algorithm": algorithm,
        "environment": environment,
        "meanReward": float(mean_reward),
        "stdReward": float(std_reward),
        "episodes": int(episodes),
        "trainingTime": float(training_time),
    }
    if artifacts:
        payload["artifacts"] = artifacts

    res = requests.post(
        _api(),
        headers={"Authorization": f"Bearer {login()}"},
        json=payload,
        timeout=60,
    )
    if not res.ok:
        raise SystemExit(f"Submit failed ({res.status_code}): {_error_message(res)}")
    return res.json()["id"]
