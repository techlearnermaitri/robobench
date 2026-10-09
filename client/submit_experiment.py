"""Submit one experiment result to RoboBench (Firestore).

Usage (from robobench/client, with the venv active):

    python submit_experiment.py --uid YOUR_FIREBASE_UID \
        --algorithm PPO --mean-reward 487.2 --std-reward 21.4 \
        --training-time 183.5

Find your UID in the Firebase console: Build > Authentication > Users.
"""

import argparse

import firebase_admin
from firebase_admin import credentials, firestore

KEY_FILE = "serviceAccountKey.json"


def get_db():
    cred = credentials.Certificate(KEY_FILE)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def submit(db, uid, algorithm, environment, mean_reward, std_reward,
           episodes, training_time):
    doc = {
        "ownerId": uid,
        "algorithm": algorithm,
        "environment": environment,
        "meanReward": float(mean_reward),
        "stdReward": float(std_reward),
        "episodes": int(episodes),
        "trainingTime": float(training_time),
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    _, ref = db.collection("experiments").add(doc)
    return ref.id


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--uid", required=True, help="Your Firebase Auth UID")
    p.add_argument("--algorithm", default="PPO")
    p.add_argument("--environment", default="CartPole-v1")
    p.add_argument("--mean-reward", type=float, required=True)
    p.add_argument("--std-reward", type=float, default=0.0)
    p.add_argument("--episodes", type=int, default=100)
    p.add_argument("--training-time", type=float, required=True)
    args = p.parse_args()

    db = get_db()
    exp_id = submit(
        db,
        args.uid,
        args.algorithm,
        args.environment,
        args.mean_reward,
        args.std_reward,
        args.episodes,
        args.training_time,
    )
    print(f"Saved experiment {exp_id}")


if __name__ == "__main__":
    main()