import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/?$/, "/");

export default function Leaderboard({ projectId, refreshKey }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const q = query(
          collection(db, "experiments"),
          where("projectId", "==", projectId)
        );
        const snap = await getDocs(q);
        setAll(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, refreshKey]);

  // Higher reward first; on a tie, faster training wins.
  const rows = useMemo(
    () =>
      [...all].sort(
        (a, b) =>
          b.meanReward - a.meanReward || a.trainingTime - b.trainingTime
      ),
    [all]
  );

  async function download(experimentId) {
    setDownloading(experimentId);
    setError("");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`${API_BASE}download-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ experimentId, kind: "model" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      window.location.href = body.url;
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading("");
    }
  }

  if (loading) return <p className="muted">Loading experiments…</p>;
  if (rows.length === 0 && !error)
    return <p className="muted">No experiments in this project yet.</p>;

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Algorithm</th>
              <th className="num">Mean reward</th>
              <th className="num">Std</th>
              <th className="num">Training time (s)</th>
              <th>Model</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>{r.algorithm}</td>
                <td className="num">{Number(r.meanReward).toFixed(1)}</td>
                <td className="num">{Number(r.stdReward).toFixed(1)}</td>
                <td className="num">{Number(r.trainingTime).toFixed(1)}</td>
                <td>
                  {r.artifacts?.model ? (
                    <button
                      className="ghost"
                      disabled={downloading === r.id}
                      onClick={() => download(r.id)}
                    >
                      {downloading === r.id ? "…" : "Download"}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
