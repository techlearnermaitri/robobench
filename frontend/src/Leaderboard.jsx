import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

export default function Leaderboard({ projectId, refreshKey }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (loading) return <p className="muted">Loading experiments…</p>;
  if (error) return <p className="error">{error}</p>;
  if (rows.length === 0)
    return <p className="muted">No experiments in this project yet.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Algorithm</th>
            <th className="num">Mean reward</th>
            <th className="num">Std</th>
            <th className="num">Training time (s)</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
