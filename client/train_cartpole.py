"""Train a CartPole agent locally with Stable-Baselines3, upload the model and
a reward curve to Azure Blob Storage, and submit the results to a RoboBench
project.

Usage (from robobench/client, venv active):

    python train_cartpole.py --project-id YOUR_PROJECT_ID --algo PPO
    python train_cartpole.py --project-id YOUR_PROJECT_ID --algo A2C --no-plot
    python train_cartpole.py --project-id YOUR_PROJECT_ID --algo DQN --no-upload

Or set ROBOBENCH_PROJECT_ID in client/.env and skip --project-id.
"""

import argparse
import os
import tempfile
import time

import gymnasium as gym
from stable_baselines3 import A2C, DQN, PPO
from stable_baselines3.common.evaluation import evaluate_policy
from stable_baselines3.common.monitor import Monitor

import robobench  # loads client/.env on import
from plotting import save_reward_curve

ALGOS = {"PPO": PPO, "A2C": A2C, "DQN": DQN}
ENV_ID = "CartPole-v1"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project-id", default=os.environ.get("ROBOBENCH_PROJECT_ID"))
    p.add_argument("--algo", choices=ALGOS.keys(), default="PPO")
    p.add_argument("--timesteps", type=int, default=50_000)
    p.add_argument("--eval-episodes", type=int, default=100)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--no-upload", action="store_true",
                   help="skip uploading anything to Azure")
    p.add_argument("--no-plot", action="store_true",
                   help="skip the reward curve")
    args = p.parse_args()

    if not args.project_id:
        p.error("Provide --project-id or set ROBOBENCH_PROJECT_ID in client/.env")

    # Monitor records the reward and length of every training episode.
    env = Monitor(gym.make(ENV_ID))
    model = ALGOS[args.algo]("MlpPolicy", env, seed=args.seed,
                             device="cpu", verbose=0)

    print(f"Training {args.algo} on {ENV_ID} for {args.timesteps} steps...")
    start = time.time()
    model.learn(total_timesteps=args.timesteps)
    training_time = time.time() - start

    # Read the training curve now, before evaluation adds more episodes.
    train_rewards = list(env.get_episode_rewards())
    train_lengths = list(env.get_episode_lengths())

    print(f"Evaluating over {args.eval_episodes} episodes...")
    mean_reward, std_reward = evaluate_policy(
        model, model.get_env(), n_eval_episodes=args.eval_episodes
    )

    print(f"mean_reward={mean_reward:.1f}  std={std_reward:.1f}  "
          f"time={training_time:.1f}s")

    artifacts = {}
    with tempfile.TemporaryDirectory() as tmp:
        if not args.no_upload:
            base = os.path.join(tmp, f"{args.algo.lower()}_cartpole")
            model.save(base)  # Stable-Baselines3 adds the .zip extension
            print("Uploading model to Azure...")
            artifacts["model"] = robobench.upload_file(args.project_id, base + ".zip")

            if not args.no_plot:
                plot_path = os.path.join(tmp, "reward_curve.png")
                title = f"{args.algo} on {ENV_ID}  (seed {args.seed})"
                if save_reward_curve(train_rewards, train_lengths, plot_path, title):
                    print("Uploading reward curve to Azure...")
                    artifacts["plot"] = robobench.upload_file(args.project_id, plot_path)
                else:
                    print("Too few training episodes to draw a curve; skipping it.")

        exp_id = robobench.submit(
            args.project_id,
            args.algo,
            ENV_ID,
            mean_reward,
            std_reward,
            args.eval_episodes,
            training_time,
            artifacts=artifacts,
        )
    print(f"Saved experiment {exp_id}")


if __name__ == "__main__":
    main()
