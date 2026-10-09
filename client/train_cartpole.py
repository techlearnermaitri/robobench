"""Train a CartPole agent locally with Stable-Baselines3, then submit the
results to a RoboBench project through the Catalyst API.

Usage (from robobench/client, venv active):

    python train_cartpole.py --project-id YOUR_PROJECT_ID --algo PPO
    python train_cartpole.py --project-id YOUR_PROJECT_ID --algo A2C
    python train_cartpole.py --project-id YOUR_PROJECT_ID --algo DQN

Or set ROBOBENCH_PROJECT_ID in client/.env and skip --project-id.
"""

import argparse
import os
import time

from stable_baselines3 import A2C, DQN, PPO
from stable_baselines3.common.evaluation import evaluate_policy

import robobench  # loads client/.env on import

ALGOS = {"PPO": PPO, "A2C": A2C, "DQN": DQN}
ENV_ID = "CartPole-v1"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project-id", default=os.environ.get("ROBOBENCH_PROJECT_ID"))
    p.add_argument("--algo", choices=ALGOS.keys(), default="PPO")
    p.add_argument("--timesteps", type=int, default=50_000)
    p.add_argument("--eval-episodes", type=int, default=100)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    if not args.project_id:
        p.error("Provide --project-id or set ROBOBENCH_PROJECT_ID in client/.env")

    model = ALGOS[args.algo]("MlpPolicy", ENV_ID, seed=args.seed,
                             device="cpu", verbose=0)

    print(f"Training {args.algo} on {ENV_ID} for {args.timesteps} steps...")
    start = time.time()
    model.learn(total_timesteps=args.timesteps)
    training_time = time.time() - start

    print(f"Evaluating over {args.eval_episodes} episodes...")
    mean_reward, std_reward = evaluate_policy(
        model, model.get_env(), n_eval_episodes=args.eval_episodes
    )

    print(f"mean_reward={mean_reward:.1f}  std={std_reward:.1f}  "
          f"time={training_time:.1f}s")

    exp_id = robobench.submit(
        args.project_id,
        args.algo,
        ENV_ID,
        mean_reward,
        std_reward,
        args.eval_episodes,
        training_time,
    )
    print(f"Saved experiment {exp_id}")


if __name__ == "__main__":
    main()
