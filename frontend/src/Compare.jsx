import StatusBadge from "./StatusBadge.jsx";

const COLORS = ["#1f6f5c", "#c2610f", "#2b5fa8", "#8a4b9c"];
// Different dash patterns too, so the lines are not told apart by colour alone.
const DASHES = ["", "7 4", "2 3", "10 3 2 3"];

const W = 640;
const H = 340;
const MARGIN = { left: 56, right: 20, top: 16, bottom: 46 };

function niceStep(range, count) {
  const raw = range / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

// Round axis limits outwards to tidy numbers and list the tick values.
function niceScale(lo, hi, count = 5) {
  if (!(hi > lo)) hi = lo + 1;
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toFixed(8)));
  }
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1] };
}

function fmt(v) {
  return Math.abs(v) >= 1000 ? `${Number((v / 1000).toFixed(2))}k` : String(v);
}

function Chart({ series }) {
  const allSteps = series.flatMap((s) => s.curve.steps);
  const allRewards = series.flatMap((s) => s.curve.rewards);
  const xs = niceScale(0, Math.max(...allSteps));
  const ys = niceScale(Math.min(0, ...allRewards), Math.max(...allRewards));

  const x = (v) =>
    MARGIN.left + ((v - xs.min) / (xs.max - xs.min)) * (W - MARGIN.left - MARGIN.right);
  const y = (v) =>
    MARGIN.top + (1 - (v - ys.min) / (ys.max - ys.min)) * (H - MARGIN.top - MARGIN.bottom);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Smoothed training reward of the selected experiments"
    >
      {ys.ticks.map((t) => (
        <g key={`y${t}`}>
          <line className="grid" x1={MARGIN.left} x2={W - MARGIN.right} y1={y(t)} y2={y(t)} />
          <text x={MARGIN.left - 8} y={y(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {xs.ticks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={H - MARGIN.bottom + 18} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      <line
        className="axis"
        x1={MARGIN.left}
        x2={W - MARGIN.right}
        y1={H - MARGIN.bottom}
        y2={H - MARGIN.bottom}
      />
      <text
        className="axis-title"
        x={(MARGIN.left + W - MARGIN.right) / 2}
        y={H - 6}
        textAnchor="middle"
      >
        Training timesteps
      </text>
      <text
        className="axis-title"
        transform={`translate(14 ${(MARGIN.top + H - MARGIN.bottom) / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        Reward (moving average)
      </text>

      {series.map((s) => (
        <polyline
          key={s.id}
          className="line"
          stroke={s.color}
          strokeDasharray={s.dash}
          points={s.curve.steps
            .map((st, i) => `${x(st).toFixed(1)},${y(s.curve.rewards[i]).toFixed(1)}`)
            .join(" ")}
        />
      ))}
    </svg>
  );
}

const METRICS = [
  { label: "Algorithm", text: (r) => r.algorithm },
  { label: "Submitted by", text: (r) => r.ownerName || "—" },
  {
    label: "Mean reward",
    text: (r) => Number(r.meanReward).toFixed(1),
    value: (r) => r.meanReward,
    best: "max",
  },
  { label: "Std reward", text: (r) => Number(r.stdReward).toFixed(1) },
  {
    label: "Training time (s)",
    text: (r) => Number(r.trainingTime).toFixed(1),
    value: (r) => r.trainingTime,
    best: "min",
  },
  { label: "Evaluation episodes", text: (r) => r.episodes },
  { label: "Check", render: (r) => <StatusBadge row={r} /> },
];

export default function Compare({ rows }) {
  const series = rows.map((r, i) => ({
    id: r.id,
    label: `#${r.rank} ${r.algorithm}${r.ownerName ? ` · ${r.ownerName}` : ""}`,
    color: COLORS[i % COLORS.length],
    dash: DASHES[i % DASHES.length],
    curve:
      r.curve && Array.isArray(r.curve.steps) && r.curve.steps.length >= 2
        ? r.curve
        : null,
  }));
  const drawable = series.filter((s) => s.curve);

  return (
    <section className="compare">
      <h3>Comparing {rows.length} experiments</h3>

      {drawable.length > 0 ? (
        <Chart series={drawable} />
      ) : (
        <p className="muted">
          None of the selected runs recorded a training curve, so there is nothing to
          overlay. Runs made with the latest <code>train_cartpole.py</code> include one.
        </p>
      )}

      <ul className="legend">
        {series.map((s) => (
          <li key={s.id}>
            <svg viewBox="0 0 28 8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke={s.color}
                strokeWidth="2.4"
                strokeDasharray={s.dash}
              />
            </svg>
            <span>{s.label}</span>
            {!s.curve && <span className="muted">(no curve recorded)</span>}
          </li>
        ))}
      </ul>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              {series.map((s) => (
                <th key={s.id}>
                  <span className="swatch" style={{ background: s.color }} /> {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const values = m.value ? rows.map(m.value) : [];
              const target =
                m.best === "max" ? Math.max(...values) : m.best === "min" ? Math.min(...values) : null;
              const differs = new Set(values).size > 1;
              return (
                <tr key={m.label}>
                  <th scope="row">{m.label}</th>
                  {rows.map((r) => (
                    <td
                      key={r.id}
                      className={differs && m.value && m.value(r) === target ? "best" : ""}
                    >
                      {m.render ? m.render(r) : m.text(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
