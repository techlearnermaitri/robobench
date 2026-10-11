"""Training-curve helpers: draw a PNG, and make a compact curve for Firestore."""

import matplotlib

matplotlib.use("Agg")  # draw to a file, no window needed

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402


def _smooth(rewards, lengths, window):
    """Moving average of episode rewards, with the timestep each point ends at."""
    rewards = np.asarray(rewards, dtype=float)
    steps = np.cumsum(np.asarray(lengths, dtype=float))
    # Short runs get a short window so there are still enough points to draw.
    w = max(1, min(window, len(rewards) // 5))
    smooth = np.convolve(rewards, np.ones(w) / w, mode="valid")
    return rewards, steps, smooth, steps[w - 1:], w


def save_reward_curve(rewards, lengths, path, title, window=20):
    """Plot episode reward against training timesteps.

    Returns False (and writes nothing) if there are too few episodes to plot.
    """
    if len(rewards) < 2:
        return False

    rewards, steps, smooth, smooth_steps, w = _smooth(rewards, lengths, window)

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


def downsample_curve(rewards, lengths, window=20, points=100):
    """A small smoothed curve ({"steps": [...], "rewards": [...]}) for Firestore.

    The website overlays these curves to compare runs. Returns None if there
    are too few episodes.
    """
    if len(rewards) < 2:
        return None

    _, _, smooth, smooth_steps, _ = _smooth(rewards, lengths, window)
    if len(smooth) < 2:
        return None

    if len(smooth) > points:
        keep = np.unique(np.linspace(0, len(smooth) - 1, points).round().astype(int))
        smooth, smooth_steps = smooth[keep], smooth_steps[keep]

    return {
        "steps": [int(s) for s in smooth_steps],
        "rewards": [round(float(r), 2) for r in smooth],
    }
