import "dotenv/config";
import { createExchange } from "../../solver/market.mjs";
const ex = createExchange(process.env);
await ex.client.watchPrices(["BTC","ETH"]).catch(e=>console.log("watch err", e.message.slice(0,100)));
await new Promise(r=>setTimeout(r,3000));
for (const a of ["BTC","ETH"]) console.log("live", a, JSON.stringify(ex.client.getLivePrice(a)));
for (const a of ["BTC","ETH"]) {
  try { const p = await ex.client.fetchPrice(a); console.log("fetchPrice", a, JSON.stringify(p)); } catch(e){ console.log("fetchPrice ERR", e.message.slice(0,100)); }
}
try { const cs = await ex.client.fetchPriceCandles("BTC", 60, { limit: 3 }); console.log("candles BTC", JSON.stringify(cs)); } catch(e){ console.log("candles ERR", e.message.slice(0,200)); }
try { const feeds = await ex.client.listPriceFeeds(); console.log("feeds", JSON.stringify(feeds).slice(0,600)); } catch(e){ console.log("feeds ERR", e.message.slice(0,150)); }
process.exit(0);
