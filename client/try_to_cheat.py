"""Test helper for the verifier: submit a WEAK model but claim a perfect score.

After the verification worker runs, this experiment should be marked
"rejected". Usage (from robobench/client, venv active):

    python try_to_cheat.py --project-id YOUR_PROJECT_ID
"""

import argparse
import os
import tempfile

from stable_baselines3 import PPO

import robobench  # loads client/.env on import

ENV_ID = "CartPole-v1"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project-id", default=os.environ.get("ROBOBENCH_PROJECT_ID"))
    args = p.parse_args()
    if not args.project_id:
        p.error("Provide --project-id or set ROBOBENCH_PROJECT_ID in client/.env")

    print("Training a deliberately weak model (2000 steps)...")
    model = PPO("MlpPolicy", ENV_ID, seed=1, device="cpu", verbose=0)
    model.learn(total_timesteps=2_000)

    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, "cheater_cartpole")
        model.save(base)
        blob = robobench.upload_file(args.project_id, base + ".zip")
        exp_id = robobench.submit(
            args.project_id, "PPO", ENV_ID,
            500.0, 0.0, 100, 12.3,       # the false claim
            artifacts={"model": blob},
        )
    print(f"Submitted fake experiment {exp_id} (claims 500.0)")


if __name__ == "__main__":
    main()
