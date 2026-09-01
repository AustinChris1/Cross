import "dotenv/config";
import { createExchange } from "../../solver/market.mjs";
const ex = createExchange(process.env);
const feeds = await ex.client.listPriceFeeds();
const now = Date.now();
console.log("total feeds", feeds.length);
for (const f of feeds) {
  const age = Math.round((now - Number(f.updatedAtMs)) / 1000);
  if (["BTC","ETH","SOL","AAVE"].includes(f.asset)) console.log(`${f.asset.padEnd(5)} price ${String(f.latest?.price).padEnd(12)} updatedAgo ${age}s  blockTs ${f.latest?.blockTimestamp}`);
}
const stale = feeds.filter(f => now - Number(f.updatedAtMs) > 300000);
console.log("stale feeds (>5m):", stale.map(f=>f.asset).join(",") || "none");
// Oracle-native spot: the strike embedded in the newest fixed-strike test market.
const live = await ex.client.listLiveBinaryMarkets({ limit: 40 });
const fixed = live.filter(m => m.mode === "fixed").sort((a,b)=>Number(b.tradingStart)-Number(a.tradingStart));
console.log("\noracle-native samples from fixed-strike test markets:");
for (const m of fixed.slice(0,4)) console.log(` ${m.asset} strike ${Number(m.strike)/100} createdAt ${m.tradingStart} (age ${Math.floor(Date.now()/1000)-Number(m.tradingStart)}s)`);
process.exit(0);
