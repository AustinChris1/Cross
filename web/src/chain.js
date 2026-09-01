// Chain wiring for the app: read through a public client, write through the injected wallet.
import { createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";

export const SHANNON = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
  blockExplorers: { default: { name: "Shannon", url: "https://shannon-explorer.somnia.network" } },
  testnet: true,
};

export const CFG = {
  cross: import.meta.env.VITE_CROSS_ADDRESS ?? "",
  vault: import.meta.env.VITE_VAULT_ADDRESS ?? "",
  collateral: import.meta.env.VITE_COLLATERAL ?? "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  indexer: import.meta.env.VITE_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  priceFeed: import.meta.env.VITE_PRICE_FEED_URL ?? "https://price-feed.dev.oracle.somnia.host/v1/graphql",
  venue: import.meta.env.VITE_VENUE_ID ?? "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  explorer: "https://shannon-explorer.somnia.network",
};

export const publicClient = createPublicClient({ chain: SHANNON, transport: http(SHANNON.rpcUrls.default.http[0]) });

export function walletClient() {
  if (!window.ethereum) throw new Error("no injected wallet found");
  return createWalletClient({ chain: SHANNON, transport: custom(window.ethereum) });
}

export const erc20Abi = parseAbi([
  "function faucet(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address o, address s) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export async function connect() {
  const wc = walletClient();
  const [address] = await wc.requestAddresses();
  const id = await wc.getChainId();
  if (id !== SHANNON.id) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc488" }] });
    } catch {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xc488",
            chainName: SHANNON.name,
            nativeCurrency: SHANNON.nativeCurrency,
            rpcUrls: SHANNON.rpcUrls.default.http,
            blockExplorerUrls: [CFG.explorer],
          },
        ],
      });
    }
  }
  return address;
}

// The indexer speaks GraphQL; these two reads are all the app needs from it.
async function gql(query, variables) {
  const res = await fetch(CFG.indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

const MARKETS_QUERY = `
  query LiveWindows($venue: String!, $now: numeric!) {
    Market(
      where: {
        marketType: {_eq: "BINARY"},
        venueId: {_eq: $venue},
        strike: {_eq: "0"},
        expiry: {_gt: $now}
      },
      order_by: {expiry: asc},
      limit: 40
    ) {
      id
      poolAddress
      marketAddress
      asset
      question
      expiry
      tradingStart
      intervalSec
      yesTokenId
      noTokenId
      clobStatus
      oracleQuestionId
      cumulativeQuoteVolume
      tradeCount
    }
  }
`;

export async function liveWindows() {
  const now = Math.floor(Date.now() / 1000);
  const data = await gql(MARKETS_QUERY, { venue: CFG.venue, now: now + 360 });
  return (data.Market ?? []).map((m) => ({
    marketId: m.id,
    pool: m.poolAddress,
    market: m.marketAddress,
    asset: m.asset,
    question: m.question,
    expiry: Number(m.expiry),
    tradingStart: Number(m.tradingStart),
    intervalSec: Number(m.intervalSec),
    interval: labelInterval(Number(m.intervalSec)),
    status: m.clobStatus,
    oracleQuestionId: m.oracleQuestionId,
    volume: Number(m.cumulativeQuoteVolume ?? 0) / 1e6,
    trades: Number(m.tradeCount ?? 0),
  }));
}

function labelInterval(sec) {
  if (sec % 86400 === 0) return `${sec / 86400}d`;
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  return `${sec / 60}m`;
}

const OPENING_QUERY = `
  query Openings($ids: [String!]) {
    MarketReferenceLink(where: {market_id: {_in: $ids}}) { market_id referenceQuestionId }
  }
`;
const ANSWER_QUERY = `
  query Answers($qids: [numeric!]) {
    OracleAnswer(where: {oracleQuestionId: {_in: $qids}}) { oracleQuestionId numericValue }
  }
`;

/** Opening prints per marketId, in human units. Oracle answers carry two decimals. */
export async function openingPrices(marketIds) {
  if (!marketIds.length) return {};
  const ids = marketIds.map((i) => i.toLowerCase());
  const links = (await gql(OPENING_QUERY, { ids })).MarketReferenceLink ?? [];
  const qids = links.map((l) => Number(l.referenceQuestionId));
  if (!qids.length) return {};
  const answers = (await gql(ANSWER_QUERY, { qids })).OracleAnswer ?? [];
  const byQid = Object.fromEntries(answers.map((a) => [String(a.oracleQuestionId), a.numericValue]));
  const out = {};
  for (const l of links) {
    const v = byQid[String(l.referenceQuestionId)];
    if (v != null) out[l.market_id] = Number(v) / 100;
  }
  return out;
}

const FEED_QUERY = `
  query Feeds {
    Feed { id base quote decimals latestSpot latestUpdatedAtMs }
  }
`;

/**
 * Live spot per asset.
 * The feed carries one row per pair and the USDT rows are long dead, so rows are chosen
 * by recency rather than by base asset alone.
 */
export async function spotPrices(assets) {
  try {
    const res = await fetch(CFG.priceFeed, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: FEED_QUERY }),
    });
    const rows = (await res.json())?.data?.Feed ?? [];
    const now = Date.now();
    const best = {};
    for (const r of rows) {
      if (!assets.includes(r.base)) continue;
      const age = (now - Number(r.latestUpdatedAtMs)) / 1000;
      const price = Number(r.latestSpot) / 10 ** Number(r.decimals);
      if (!(price > 0) || age > 120) continue;
      if (!best[r.base] || age < best[r.base].age) best[r.base] = { price, age };
    }
    return Object.fromEntries(assets.map((a) => [a, best[a]?.price ?? null]));
  } catch {
    return Object.fromEntries(assets.map((a) => [a, null]));
  }
}
