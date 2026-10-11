import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import Leaderboard from "./Leaderboard.jsx";
import AddExperiment from "./AddExperiment.jsx";

export default function ProjectPage({ project, user, onBack }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [submissions, setSubmissions] = useState(project.submissions || "owner");
  const [error, setError] = useState("");

  const isOwner = project.ownerId === user.uid;
  const isOpen = submissions === "anyone";
  const canSubmit = isOwner || isOpen;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(project.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the ID is visible anyway */
    }
  }

  async function toggleOpen(e) {
    const next = e.target.checked ? "anyone" : "owner";
    setError("");
    try {
      await updateDoc(doc(db, "projects", project.id), { submissions: next });
      setSubmissions(next);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <button className="ghost back" onClick={onBack}>
        ← All projects
      </button>

      <h2 className="project-title">{project.name}</h2>
      <p className="muted meta">
        {project.category} · {project.environment} · {project.framework}
        {isOpen ? " · Open to all" : ""}
      </p>
      <p className="id-row">
        <span className="muted">Project ID</span>
        <code>{project.id}</code>
        <button className="ghost" onClick={copyId}>
          {copied ? "Copied" : "Copy"}
        </button>
      </p>

      {isOwner && (
        <label className="check owner-toggle">
          <input type="checkbox" checked={isOpen} onChange={toggleOpen} />
          Let anyone submit to this project
        </label>
      )}
      {error && <p className="error">{error}</p>}

      <main className="layout">
        <section>
          <h2>Leaderboard</h2>
          <Leaderboard projectId={project.id} refreshKey={refreshKey} />
        </section>
        <section>
          <h2>Submit an experiment</h2>
          {canSubmit ? (
            <AddExperiment
              user={user}
              project={project}
              onAdded={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <p className="muted">Only the project owner can submit experiments.</p>
          )}
        </section>
      </main>
    </div>
  );
}
