"""RoboBench verification worker.

Runs once and exits (so it suits a scheduled container job). For each pending
experiment it:
  1. asks the Catalyst API for work (/worker/next),
  2. downloads the submitted model from Azure with a short-lived link,
  3. re-evaluates it in a separate, secret-free child process,
  4. reports the measured score back (/worker/result). The API decides the verdict.

Settings (environment variables, or verifier/.env when run locally):
    ROBOBENCH_API_URL   e.g. https://...catalystserverless.in/server/submit_experiment/
    WORKER_SECRET       the same value as in workerConfig.json on the backend

SECURITY: Stable-Baselines3 model files contain pickled data, and loading a
pickle can run arbitrary code. Anyone who can submit a model can therefore run
code inside this worker. That is why the evaluation happens in a child process
with an empty environment (no WORKER_SECRET), and why this should run in a
disposable container, not on a machine with files you care about, once other
people can upload models.
"""

import json
import os
import subprocess
import sys
import tempfile
import zipfile

import requests

EVAL_TIMEOUT = int(os.environ.get("EVAL_TIMEOUT_SECONDS", "600"))
MAX_JOBS = int(os.environ.get("MAX_JOBS", "10"))
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_UNZIPPED_BYTES = 500 * 1024 * 1024


class BadModelFile(Exception):
    """The uploaded file is not a usable model (reported as a failed check)."""


# ---------------------------------------------------------------- child side
def evaluate_model(model_path, algorithm, env_id, episodes):
    """Load the model and measure its mean/std reward. Runs in the child."""
    import gymnasium as gym
    from stable_baselines3 import A2C, DQN, PPO
    from stable_baselines3.common.evaluation import evaluate_policy

    classes = {"PPO": PPO, "A2C": A2C, "DQN": DQN}
    model = classes[algorithm].load(model_path, device="cpu")
    env = gym.make(env_id)
    mean, std = evaluate_policy(model, env, n_eval_episodes=episodes)
    return float(mean), float(std)


def child_main(args):
    model_path, algorithm, env_id, episodes = args
    try:
        mean, std = evaluate_model(model_path, algorithm, env_id, int(episodes))
        print(json.dumps({"ok": True, "mean": mean, "std": std}))
    except Exception as exc:  # noqa: BLE001 - report anything back to the parent
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300]}))


# --------------------------------------------------------------- parent side
def download_model(url, dest):
    with requests.get(url, stream=True, timeout=60) as res:
        res.raise_for_status()
        size = 0
        with open(dest, "wb") as f:
            for chunk in res.iter_content(chunk_size=1024 * 1024):
                size += len(chunk)
                if size > MAX_DOWNLOAD_BYTES:
                    raise BadModelFile("model file is too large")
                f.write(chunk)


def check_zip(path):
    if not zipfile.is_zipfile(path):
        raise BadModelFile("model file is not a zip archive")
    with zipfile.ZipFile(path) as z:
        if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED_BYTES:
            raise BadModelFile("model file expands to too much data")


def evaluate_in_sandbox(model_path, algorithm, env_id, episodes, workdir):
    """Run the evaluation in a child process that has no secrets in its environment."""
    clean_env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": workdir,
        "TMPDIR": workdir,
    }
    cmd = [sys.executable, os.path.abspath(__file__), "--evaluate",
           model_path, algorithm, env_id, str(episodes)]
    try:
        proc = subprocess.run(cmd, env=clean_env, cwd=workdir,
                              capture_output=True, text=True, timeout=EVAL_TIMEOUT)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "evaluation timed out"}

    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        return {"ok": False, "error": f"evaluator crashed (exit code {proc.returncode})"}
    try:
        return json.loads(lines[-1])
    except ValueError:
        return {"ok": False, "error": "evaluator returned invalid output"}


def process_job(job, post, evaluate=evaluate_in_sandbox, download=download_model):
    """Verify one claimed experiment and report the outcome."""
    exp_id = job["experimentId"]
    with tempfile.TemporaryDirectory() as tmp:
        model_path = os.path.join(tmp, "model.zip")
        try:
            download(job["modelUrl"], model_path)
            check_zip(model_path)
        except BadModelFile as exc:
            return post("worker/result", {"experimentId": exp_id, "failure": str(exc)})
        # network errors from download() propagate: nothing is reported, the
        # claim expires, and the job is retried later.

        result = evaluate(model_path, job["algorithm"], job["environment"],
                          job["episodes"], tmp)
        if result.get("ok"):
            return post("worker/result", {
                "experimentId": exp_id,
                "measuredMean": result["mean"],
                "measuredStd": result["std"],
                "episodes": job["episodes"],
            })
        return post("worker/result", {
            "experimentId": exp_id,
            "failure": result.get("error", "unknown error"),
        })


def make_poster(base_url, secret):
    def post(path, payload):
        res = requests.post(
            base_url.rstrip("/") + "/" + path,
            headers={"X-Worker-Secret": secret},
            json=payload,
            timeout=60,
        )
        if not res.ok:
            try:
                msg = res.json().get("error", res.text)
            except ValueError:
                msg = res.text
            raise RuntimeError(f"{path} failed ({res.status_code}): {msg}")
        return res.json()
    return post


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--evaluate":
        child_main(sys.argv[2:])
        return

    # Only the parent reads .env, so the child process never sees the secret.
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    base_url = os.environ.get("ROBOBENCH_API_URL")
    secret = os.environ.get("WORKER_SECRET")
    if not base_url or not secret:
        raise SystemExit("Set ROBOBENCH_API_URL and WORKER_SECRET")

    post = make_poster(base_url, secret)
    processed = 0
    for _ in range(MAX_JOBS):
        job = post("worker/next", {}).get("job")
        if not job:
            break
        exp_id = job["experimentId"]
        try:
            outcome = process_job(job, post)
            print(f"{exp_id}: {outcome.get('status')}")
        except Exception as exc:  # noqa: BLE001 - keep going with the next job
            print(f"{exp_id}: not reported ({exc}); it will be retried later")
        processed += 1

    print(f"Done. Handled {processed} experiment(s).")


if __name__ == "__main__":
    main()
