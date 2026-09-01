// Live market state for CROSS: which windows are fillable, what the book says, what fair is.
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { fairUpProbability, realizedVol } from "./pricing.mjs";

// Markets this close to expiry can lock mid-flight, per the venue's own gotchas.
export const MIN_HEADROOM_SEC = 360;
// Oracle answers carry 2 decimals; the price feed carries 18.
const ORACLE_SCALE = 1e2;
const DEFAULT_VOL = 0.6;
export const PRICE_FEED_URL = "https://price-feed.dev.oracle.somnia.host/v1/graphql";

export function createExchange(env) {
  return new SomniaMarkets({
    indexerUrl: env.INDEXER_URL,
    chain: somniaShannon,
    wsRpcUrl: env.WS_RPC_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    priceFeed: { url: env.PRICE_FEED_URL ?? PRICE_FEED_URL },
    privateKey: env.PRIVATE_KEY,
  });
}

/** Reference-mode up/down windows on our venue with enough headroom to fill safely. */
export async function fillableWindows(ex, venueId, now = Math.floor(Date.now() / 1000)) {
  const live = await ex.client.listLiveBinaryMarkets({ limit: 60 });
  return live
    .filter((m) => m.mode === "reference")
    .filter((m) => !venueId || m.venueId?.toLowerCase() === venueId.toLowerCase())
    .filter((m) => m.status === "Trading")
    .filter((m) => Number(m.expiry) - now > MIN_HEADROOM_SEC)
    .sort((a, b) => Number(a.expiry) - Number(b.expiry));
}

/** Opening prints keyed by marketId, scaled out of the oracle's integer format. */
export async function openingPrices(ex, markets) {
  const raw = await ex.client.getOpeningPrices(markets.map((m) => m.marketId));
  const out = {};
  for (const m of markets) {
    const v = raw[m.marketId.toLowerCase()];
    out[m.marketId] = v == null ? null : Number(v) / ORACLE_SCALE;
  }
  return out;
}

/** Annualized vol per asset from one-minute feed candles. */
export async function volByAsset(ex, assets, limit = 120) {
  const out = {};
  for (const asset of assets) {
    try {
      const candles = await ex.client.fetchPriceCandles(asset, "M1", { limit });
      const closes = candles.map((c) => Number(c.close ?? c.closePrice)).filter((n) => n > 0);
      const v = realizedVol(closes, 60);
      out[asset] = v && v > 0.05 ? v : DEFAULT_VOL;
    } catch {
      out[asset] = DEFAULT_VOL;
    }
  }
  return out;
}

/**
 * Live spot per asset.
 * The feed indexer carries more than one row per asset and a long-dead row can shadow the
 * live one, so rows are chosen by recency rather than by first match.
 */
export async function spotPrices(ex, assets, maxAgeSec = 120) {
  const feeds = await ex.client.listPriceFeeds();
  const now = Date.now();
  const best = {};
  for (const f of feeds) {
    if (!assets.includes(f.asset)) continue;
    const ageSec = (now - Number(f.updatedAtMs)) / 1000;
    const price = Number(f.latest?.price ?? 0);
    if (!(price > 0) || ageSec > maxAgeSec) continue;
    if (!best[f.asset] || ageSec < best[f.asset].ageSec) best[f.asset] = { price, ageSec };
  }
  const out = {};
  for (const a of assets) out[a] = best[a]?.price ?? null;
  return out;
}

/** Everything the vault needs to price one window right now. */
export async function priceWindows(ex, markets, now = Math.floor(Date.now() / 1000)) {
  const assets = [...new Set(markets.map((m) => m.asset))];
  const [opens, vols, spots] = await Promise.all([
    openingPrices(ex, markets),
    volByAsset(ex, assets),
    spotPrices(ex, assets),
  ]);
  return markets.map((m) => {
    const opening = opens[m.marketId];
    const spot = spots[m.asset];
    const vol = vols[m.asset];
    const secondsLeft = Number(m.expiry) - now;
    const fairUp = opening && spot ? fairUpProbability({ spot, opening, secondsLeft, vol }) : null;
    return { market: m, opening, spot, vol, secondsLeft, fairUp };
  });
}

/** Best resting prices on a window, as probabilities. */
export async function bookTop(ex, poolAddress) {
  try {
    const book = await ex.client.getBinaryOrderBook(poolAddress, { depth: 1 });
    const bid = book?.yes?.bids?.[0]?.price ?? book?.bids?.[0]?.price ?? null;
    const ask = book?.yes?.asks?.[0]?.price ?? book?.asks?.[0]?.price ?? null;
    return { bid: bid == null ? null : Number(bid), ask: ask == null ? null : Number(ask) };
  } catch {
    return { bid: null, ask: null };
  }
}
