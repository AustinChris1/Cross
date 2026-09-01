// Same digital-option model the vault quotes with, so the screen and the vault agree.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export function fairUpProbability({ spot, opening, secondsLeft, vol = 0.3 }) {
  if (!(spot > 0) || !(opening > 0) || !(vol > 0)) return null;
  if (secondsLeft <= 0) return spot >= opening ? 1 : 0;
  const T = secondsLeft / (365 * 24 * 3600);
  const sT = vol * Math.sqrt(T);
  if (sT <= 0) return spot >= opening ? 1 : 0;
  return normCdf((Math.log(spot / opening) - 0.5 * vol * vol * T) / sT);
}

export const pct = (p) => `${(p * 100).toFixed(1)}%`;
export const usd = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function countdown(sec) {
  if (sec <= 0) return "settling";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Vertical position of spot in the race panel, as a percentage from the top.
 * The scale is the window's own expected move (vol * sqrt(T)), so a 15m window and a 1d
 * window are both legible instead of one of them pegging to the edge.
 */
export function racePosition({ spot, opening, intervalSec, vol = 0.3 }) {
  if (!(spot > 0) || !(opening > 0)) return 50;
  const T = Math.max(intervalSec, 60) / (365 * 24 * 3600);
  const expected = Math.max(vol * Math.sqrt(T), 0.0002);
  const moved = spot / opening - 1;
  // Two expected moves fill the panel in each direction.
  const deflection = Math.max(-40, Math.min(40, (moved / (2 * expected)) * 40));
  return 50 - deflection;
}
