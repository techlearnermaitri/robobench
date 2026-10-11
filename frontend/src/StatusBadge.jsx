export default function StatusBadge({ row }) {
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
  if (row.status === "unsupported") {
    return <span className="badge" title={v.note || ""}>Not checkable</span>;
  }
  if (!row.artifacts?.model) {
    return <span className="badge" title="No model file uploaded">No model</span>;
  }
  return <span className="badge">Pending</span>;
}
