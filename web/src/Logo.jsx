// The mark: an up chevron and a down chevron locked through each other like two chain links.
// The up chevron breaks at the left crossing, the down chevron breaks at the right, so each
// one passes through the other exactly once. Neither side can let go until the window settles.
const UP_A = "M6 20 L7.9 17.7";
const UP_B = "M10.7 14.3 L16 8 L26 20";
const DOWN_A = "M6 12 L16 24 L21.3 17.7";
const DOWN_B = "M24.1 14.3 L26 12";

export function Mark({ size = 30, mono = false }) {
  const up = mono ? "currentColor" : "var(--up)";
  const down = mono ? "currentColor" : "var(--down)";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="mark">
      <g strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={UP_A} stroke={up} />
        <path d={UP_B} stroke={up} />
        <path d={DOWN_A} stroke={down} />
        <path d={DOWN_B} stroke={down} />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 30, className = "" }) {
  return (
    <span className={`wordmark ${className}`}>
      <Mark size={size} />
      <span className="wordmark-text">CROSS</span>
    </span>
  );
}
