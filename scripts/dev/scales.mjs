import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const ex = new SomniaMarkets({ indexerUrl: process.env.INDEXER_URL, chain: somniaShannon, wsRpcUrl: process.env.WS_RPC_URL, addresses: SOMNIA_TESTNET_ADDRESSES });
const live = await ex.client.listLiveBinaryMarkets({ limit: 30 });
// Fixed-strike test markets embed the human strike in the question, which calibrates the scale.
const fixed = live.find(m => m.mode === "fixed" && /at or above ([\d.]+)/.test(m.question));
if (fixed) {
  const human = Number(fixed.question.match(/at or above ([\d.]+)/)[1]);
  console.log("fixed market:", fixed.asset, "raw strike", fixed.strike, "human", human, "=> scale 1e" + Math.round(Math.log10(Number(fixed.strike)/human)));
}
const ref = live.filter(m => m.mode === "reference");
const raw = await ex.client.getOpeningPrices(ref.map(m=>m.marketId));
for (const m of ref.slice(0,4)) console.log(m.asset, m.interval, "raw opening", raw[m.marketId.toLowerCase()]);
console.log("--- feeds ---");
for (const fn of ["fetchPrice","fetchPrices","listPriceFeeds"]) {
  try { const r = await ex.client[fn](fn==="fetchPrices"?["BTC","ETH"]:fn==="listPriceFeeds"?undefined:"BTC"); console.log(fn, JSON.stringify(r).slice(0,400)); } catch(e){ console.log(fn, "ERR", e.message.slice(0,140)); }
}
try { const cs = await ex.client.fetchPriceCandles("BTC", 60, { limit: 3 }); console.log("candles", JSON.stringify(cs).slice(0,500)); } catch(e){ console.log("candles ERR", e.message.slice(0,200)); }
try { await ex.client.watchPrice("BTC"); await new Promise(r=>setTimeout(r,3000)); console.log("livePrice", JSON.stringify(ex.client.getLivePrice("BTC"))); } catch(e){ console.log("watch ERR", e.message.slice(0,140)); }
process.exit(0);
