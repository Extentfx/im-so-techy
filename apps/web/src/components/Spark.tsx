/** Tiny line chart for a short series (bodyweight, sleep). Decorative: the numbers sit beside it. */
export function Spark({
  values,
  width = 120,
  height = 32,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / span) * (height - 6)}`,
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <polyline
        points={pts}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
