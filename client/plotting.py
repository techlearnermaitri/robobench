"""Draw a training reward curve as a PNG (used by train_cartpole.py)."""

import matplotlib

matplotlib.use("Agg")  # draw to a file, no window needed

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402


def save_reward_curve(rewards, lengths, path, title, window=20):
    """Plot episode reward against training timesteps.

    rewards / lengths: per-episode reward and length, in training order.
    Returns False (and writes nothing) if there are too few episodes to plot.
    """
    if len(rewards) < 2:
        return False

    rewards = np.asarray(rewards, dtype=float)
    steps = np.cumsum(np.asarray(lengths, dtype=float))
    w = max(1, min(window, len(rewards)))
    smooth = np.convolve(rewards, np.ones(w) / w, mode="valid")
    smooth_steps = steps[w - 1:]

    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    ax.plot(steps, rewards, color="#9aa7a3", linewidth=0.8, alpha=0.7,
            label="Episode reward")
    ax.plot(smooth_steps, smooth, color="#1f6f5c", linewidth=2.2,
            label=f"Moving average ({w} episodes)")

    ax.set_xlabel("Training timesteps")
    ax.set_ylabel("Episode reward")
    ax.set_title(title, loc="left", fontsize=12)
    ax.grid(True, color="#e3e6e1", linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.legend(frameon=False, loc="lower right")

    fig.tight_layout()
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    return True
