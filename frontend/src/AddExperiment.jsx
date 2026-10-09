import { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

const empty = {
  algorithm: "PPO",
  meanReward: "",
  stdReward: "",
  episodes: "100",
  trainingTime: "",
};

export default function AddExperiment({ user, project, onAdded }) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const token = await user.getIdToken();
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: project.id,
          algorithm: form.algorithm,
          environment: project.environment,
          meanReward: Number(form.meanReward),
          stdReward: Number(form.stdReward),
          episodes: Number(form.episodes),
          trainingTime: Number(form.trainingTime),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);

      setForm(empty);
      setMessage("Experiment saved.");
      onAdded();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Algorithm
        <select value={form.algorithm} onChange={set("algorithm")}>
          <option>PPO</option>
          <option>A2C</option>
          <option>DQN</option>
        </select>
      </label>
      <label>
        Environment
        <input value={project.environment} readOnly />
      </label>
      <label>
        Mean reward
        <input type="number" step="any" value={form.meanReward} onChange={set("meanReward")} required />
      </label>
      <label>
        Std reward
        <input type="number" step="any" min="0" value={form.stdReward} onChange={set("stdReward")} required />
      </label>
      <label>
        Episodes
        <input type="number" value={form.episodes} onChange={set("episodes")} required />
      </label>
      <label>
        Training time (seconds)
        <input type="number" step="any" value={form.trainingTime} onChange={set("trainingTime")} required />
      </label>
      <button type="submit" disabled={busy}>
        Save experiment
      </button>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}
