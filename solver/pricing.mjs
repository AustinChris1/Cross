// Fair value of a dreamDEX up/down window, priced as the digital option it is.
// Once a window is open the outcome is no longer a coin flip: what matters is how far
// spot has already travelled from the opening print and how little time is left to undo it.

/** Abramowitz-Stegun 7.1.26 error function, good to ~1e-7. */
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

export function normCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Annualized volatility from a series of prices sampled `stepSec` apart. */
export function realizedVol(prices, stepSec) {
  const rets = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) rets.push(Math.log(prices[i] / prices[i - 1]));
  }
  if (rets.length < 8) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const perYear = (365 * 24 * 3600) / stepSec;
  return Math.sqrt(varr * perYear);
}

/**
 * Probability that spot finishes at or above the opening print.
 * Zero-drift GBM: P(S_T >= K) = N(d2), d2 = (ln(S/K) - 0.5*sigma^2*T) / (sigma*sqrt(T)).
 */
export function fairUpProbability({ spot, opening, secondsLeft, vol }) {
  if (!(spot > 0) || !(opening > 0) || !(vol > 0)) return null;
  if (secondsLeft <= 0) return spot >= opening ? 1 : 0;
  const T = secondsLeft / (365 * 24 * 3600);
  const sT = vol * Math.sqrt(T);
  if (sT <= 0) return spot >= opening ? 1 : 0;
  const d2 = (Math.log(spot / opening) - 0.5 * vol * vol * T) / sT;
  return normCdf(d2);
}

/**
 * What the vault is willing to pay for one side, given fair value and a required edge.
 * Returns null when the ask is worse than fair minus the edge.
 */
export function quote({ fairUp, side, askPrice, edge, minPrice = 0.02, maxPrice = 0.98 }) {
  if (fairUp == null) return null;
  const fair = side === "UP" ? fairUp : 1 - fairUp;
  const limit = Math.min(maxPrice, Math.max(minPrice, fair - edge));
  return { fair, limit, acceptable: askPrice <= limit, edgeCaptured: fair - askPrice };
}

/** Human summary used by both the solver log and the vault dashboard. */
export function describe({ asset, spot, opening, secondsLeft, vol, fairUp }) {
  const moved = ((spot / opening - 1) * 100).toFixed(3);
  return `${asset} spot ${spot.toFixed(2)} vs open ${opening.toFixed(2)} (${moved}%), ${secondsLeft}s left, vol ${(vol * 100).toFixed(0)}% -> fair UP ${(fairUp * 100).toFixed(1)}%`;
}
