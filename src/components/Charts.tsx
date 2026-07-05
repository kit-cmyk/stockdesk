"use client";

// Lightweight, dependency-free SVG charts. Responsive via viewBox.

export interface SeriesPoint {
  label: string;
  value: number;
}

/** Area/line chart for a single series. */
export function LineChart({
  data,
  height = 120,
  stroke = "var(--color-primary)",
  fill = "var(--color-primary)",
  format,
}: {
  data: SeriesPoint[];
  height?: number;
  stroke?: string;
  fill?: string;
  format?: (n: number) => string;
}) {
  const W = 320;
  const H = height;
  const pad = 6;
  if (data.length === 0) return <Empty height={H} />;

  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const stepX = (W - pad * 2) / Math.max(1, data.length - 1);

  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1)},${H - pad} L${x(0)},${H - pad} Z`;
  const last = data[data.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: H }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity="0.35" />
            <stop offset="100%" stopColor={fill} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#areaGrad)" />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(data.length - 1)} cy={y(last.value)} r="3" fill={stroke} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{data[0]?.label}</span>
        <span>{format ? format(last.value) : last.value}</span>
        <span>{last?.label}</span>
      </div>
    </div>
  );
}

/** Tiny inline sparkline (no axis). */
export function Sparkline({ values, height = 32 }: { values: number[]; height?: number }) {
  const W = 100;
  const H = height;
  if (values.length === 0) return <div style={{ height: H }} />;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const stepX = W / Math.max(1, values.length - 1);
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${i * stepX},${(1 - (v - min) / span) * H}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: H }}>
      <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Horizontal bar list (e.g. top products). */
export function BarList({
  items,
  format,
}: {
  items: { label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul className="space-y-2.5">
      {items.map((it, idx) => (
        <li key={idx}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="truncate pr-2">{it.label}</span>
            <span className={`shrink-0 font-semibold ${it.value < 0 ? "text-danger" : "text-text"}`}>
              {format ? format(it.value) : it.value}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(3, (Math.abs(it.value) / max) * 100)}%` }}
            />
          </div>
          {it.sub && <div className="mt-0.5 text-[11px] text-muted">{it.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-xs text-muted" style={{ height }}>
      No data
    </div>
  );
}
