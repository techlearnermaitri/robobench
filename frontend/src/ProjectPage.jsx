import { useState } from "react";
import Leaderboard from "./Leaderboard.jsx";
import AddExperiment from "./AddExperiment.jsx";

export default function ProjectPage({ project, user, onBack }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const isOwner = project.ownerId === user.uid;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(project.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the ID is visible anyway */
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
      </p>
      <p className="id-row">
        <span className="muted">Project ID</span>
        <code>{project.id}</code>
        <button className="ghost" onClick={copyId}>
          {copied ? "Copied" : "Copy"}
        </button>
      </p>

      <main className="layout">
        <section>
          <h2>Leaderboard</h2>
          <Leaderboard projectId={project.id} refreshKey={refreshKey} />
        </section>
        <section>
          <h2>Submit an experiment</h2>
          {isOwner ? (
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
