import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";

function StatusBadge({ row }) {
  const v = row.verification || {};
  if (row.status === "validated") {
    return (
      <span className="badge ok" title={`Re-measured ${Number(v.measuredMean).toFixed(1)}`}>
        Verified
      </span>
    );
  }
  if (row.status === "rejected") {
    return <span className="badge bad" title={v.note || ""}>Rejected</span>;
  }
  if (row.status === "verifying") return <span className="badge">Checking…</span>;
  if (row.status === "unsupported") return <span className="badge" title={v.note || ""}>Not checkable</span>;
  if (!row.artifacts?.model) return <span className="badge" title="No model file uploaded">No model</span>;
  return <span className="badge">Pending</span>;
}

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/?$/, "/");

export default function Leaderboard({ projectId, refreshKey }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [plot, setPlot] = useState(null); // { id, url, loading, error }

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

  // Asks the API for a short-lived link to one of an experiment's files.
  async function getLink(experimentId, kind) {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE}download-url`, {
      method: "POST",
      // text/plain + token in the body = no CORS preflight.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ idToken: token, experimentId, kind }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body.url;
  }

  async function download(experimentId) {
    setDownloading(experimentId);
    setError("");
    try {
      window.location.href = await getLink(experimentId, "model");
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading("");
    }
  }

  async function togglePlot(experimentId) {
    if (plot && plot.id === experimentId) {
      setPlot(null); // clicking again hides it
      return;
    }
    setPlot({ id: experimentId, url: "", loading: true, error: "" });
    try {
      const url = await getLink(experimentId, "plot");
      setPlot({ id: experimentId, url, loading: false, error: "" });
    } catch (err) {
      setPlot({ id: experimentId, url: "", loading: false, error: err.message });
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
              <th>Curve</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={r.id}>
              <tr>
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
                <td>
                  {r.artifacts?.plot ? (
                    <button className="ghost" onClick={() => togglePlot(r.id)}>
                      {plot && plot.id === r.id ? "Hide" : "View"}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <StatusBadge row={r} />
                </td>
              </tr>
              {plot && plot.id === r.id && (
                <tr className="plot-row">
                  <td colSpan={8}>
                    {plot.loading && <span className="muted">Loading curve…</span>}
                    {plot.error && <span className="error">{plot.error}</span>}
                    {plot.url && (
                      <img
                        className="plot"
                        src={plot.url}
                        alt={`Training reward curve for ${r.algorithm}`}
                      />
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
