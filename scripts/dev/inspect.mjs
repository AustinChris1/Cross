import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, marketKey } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, parseAbi } from "viem";
const ex = new SomniaMarkets({ indexerUrl: process.env.INDEXER_URL, chain: somniaShannon, addresses: SOMNIA_TESTNET_ADDRESSES });
const c = ex.client;
const pc = createPublicClient({ chain: somniaShannon, transport: http(process.env.RPC_URL) });
const setAbi = parseAbi(["function getSettlement(uint256 marketKey) view returns ((address collateralToken, uint128 backing, bool finalized, bool voided, uint256 settlementFeeBpsTimes1k, address feeRecipient, address pool, uint64 nonce, uint256[] payoutNumerators))"]);
const past = await c.listPastBinaryMarkets({ limit: 30 });
console.log("=== finalized markets, settlement backing (backing>0 means unredeemed winners exist) ===");
for (const m of past.filter(x=>x.mode==="reference").slice(0,10)) {
  const key = marketKey(BigInt(m.yesTokenId));
  const r = await pc.readContract({ address: SOMNIA_TESTNET_ADDRESSES.binarySettlement, abi: setAbi, functionName: "getSettlement", args: [key] });
  console.log(m.asset, m.interval, "exp", m.expiry, "finalized", r.finalized, "voided", r.voided, "backing", r.backing.toString(), "payout", JSON.stringify(r.payoutNumerators.map(String)), "market", m.marketAddress);
}
console.log("\n=== sample MINT_SET activity row shape ===");
const live = await c.listLiveBinaryMarkets({ limit: 20 });
for (const m of live.slice(0,6)) {
  const acts = await c.getMarketActivity(m.marketAddress, { limit: 6 }).catch(()=>[]);
  const mints = acts.filter(a=>a.kind==="MINT_SET");
  if (mints.length) { console.log(m.asset, m.interval, JSON.stringify(mints[0])); break; }
  if (acts.length) console.log("kinds seen on", m.asset, m.interval, ":", acts.map(a=>a.kind).join(","));
}
process.exit(0);
