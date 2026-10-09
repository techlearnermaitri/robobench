"""RoboBench Python client: log in with Firebase, submit through the Catalyst API.

Reads settings from client/.env:
    FIREBASE_API_KEY=...        (same value as VITE_FIREBASE_API_KEY)
    ROBOBENCH_EMAIL=...
    ROBOBENCH_PASSWORD=...
    ROBOBENCH_API_URL=http://localhost:3000/server/submit_experiment/
    ROBOBENCH_PROJECT_ID=...    (optional default; copy it from the project page)
"""

import os

import requests
from dotenv import load_dotenv

load_dotenv()


def _env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing {name}. Add it to client/.env")
    return value


def login():
    """Sign in with email/password and return a Firebase ID token."""
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
    return res.json()["idToken"]


def submit(project_id, algorithm, environment, mean_reward, std_reward,
           episodes, training_time):
    """Send one experiment to the Catalyst API. Returns the new experiment id."""
    token = login()
    res = requests.post(
        _env("ROBOBENCH_API_URL"),
        headers={"Authorization": f"Bearer {token}"},
        json={
            "projectId": project_id,
            "algorithm": algorithm,
            "environment": environment,
            "meanReward": float(mean_reward),
            "stdReward": float(std_reward),
            "episodes": int(episodes),
            "trainingTime": float(training_time),
        },
        timeout=30,
    )
    if not res.ok:
        try:
            msg = res.json().get("error", res.text)
        except ValueError:
            msg = res.text
        raise SystemExit(f"Submit failed ({res.status_code}): {msg}")
    return res.json()["id"]
