// The mark: an up tick and a down tick sharing one vertex, the moment two opposite
// buyers cross and the pool mints a pair. The shared vertex is the fill.
export function Mark({ size = 28, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 22 L16 16 L27 10"
        stroke="var(--up)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 10 L16 16 L27 22"
        stroke="var(--down)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.4" fill="var(--bg)" />
      <circle cx="16" cy="16" r="2.5" fill="var(--ink)" />
    </svg>
  );
}

export function Wordmark({ size = 28 }) {
  return (
    <span className="wordmark">
      <Mark size={size} />
      <span className="wordmark-text">CROSS</span>
    </span>
  );
}
