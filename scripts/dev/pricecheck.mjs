import "dotenv/config";
import { createExchange, fillableWindows, priceWindows } from "../../solver/market.mjs";
import { describe } from "../../solver/pricing.mjs";
const ex = createExchange(process.env);
const wins = await fillableWindows(ex, process.env.VENUE_ID);
console.log("fillable windows:", wins.length);
const priced = await priceWindows(ex, wins.slice(0, 6));
for (const p of priced) {
  if (p.fairUp == null) { console.log(`${p.market.asset} ${p.market.interval}: opening=${p.opening} spot=${p.spot} -> no fair value`); continue; }
  console.log(`${p.market.interval.padEnd(4)} ${describe({ asset: p.market.asset, spot: p.spot, opening: p.opening, secondsLeft: p.secondsLeft, vol: p.vol, fairUp: p.fairUp })}`);
}
process.exit(0);
