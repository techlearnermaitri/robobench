import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const emptyForm = {
  name: "",
  category: "Reinforcement Learning",
  environment: "CartPole-v1",
  framework: "Stable-Baselines3",
  openToAll: false,
};

export default function ProjectList({ user, onOpen }) {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(collection(db, "projects"));
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        );
        setProjects(list);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = {
        ownerId: user.uid,
        name: form.name.trim(),
        category: form.category,
        environment: form.environment.trim(),
        framework: form.framework.trim(),
        submissions: form.openToAll ? "anyone" : "owner",
      };
      const ref = await addDoc(collection(db, "projects"), {
        ...data,
        createdAt: serverTimestamp(),
      });
      onOpen({ id: ref.id, ...data });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="layout">
      <section>
        <h2>Projects</h2>
        {loading && <p className="muted">Loading projects…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && projects.length === 0 && (
          <p className="muted">No projects yet. Create your first one.</p>
        )}
        <div className="cards">
          {projects.map((p) => (
            <button key={p.id} className="card" onClick={() => onOpen(p)}>
              <strong>{p.name}</strong>
              <span className="muted">
                {p.environment} · {p.framework}
              </span>
              <span className="tag">
                {p.ownerId === user.uid ? "Yours" : p.category}
                {p.submissions === "anyone" ? " · Open to all" : ""}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>New project</h2>
        <form onSubmit={handleCreate}>
          <label>
            Name
            <input
              value={form.name}
              onChange={set("name")}
              placeholder="CartPole PPO Benchmark"
              maxLength={80}
              required
            />
          </label>
          <label>
            Category
            <select value={form.category} onChange={set("category")}>
              <option>Reinforcement Learning</option>
              <option>Computer Vision</option>
              <option>Robotics</option>
            </select>
          </label>
          <label>
            Environment
            <input value={form.environment} onChange={set("environment")} required />
          </label>
          <label>
            Framework
            <input value={form.framework} onChange={set("framework")} required />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.openToAll}
              onChange={(e) => setForm({ ...form, openToAll: e.target.checked })}
            />
            Let anyone submit to this project
          </label>
          <button type="submit" disabled={busy}>
            Create project
          </button>
        </form>
      </section>
    </main>
  );
}
