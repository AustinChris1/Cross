import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, marketKey } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, parseAbi } from "viem";
const ex = new SomniaMarkets({ indexerUrl: process.env.INDEXER_URL, chain: somniaShannon, addresses: SOMNIA_TESTNET_ADDRESSES });
const c = ex.client;
const pc = createPublicClient({ chain: somniaShannon, transport: http(process.env.RPC_URL) });
const past = await c.listPastBinaryMarkets({ limit: 40 });
const ref = past.filter(m => m.mode === "reference" && !m.voided);
console.log("past reference markets:", ref.length);
const e6909 = parseAbi(["function balanceOf(address owner, uint256 id) view returns (uint256)"]);
const mkAbi = parseAbi(["function outcomeToken() view returns (address)","function payoutNumerators() view returns (uint256[])","function isResolved() view returns (bool)"]);
for (const m of ref.slice(0, 12)) {
  const acts = await c.getMarketActivity(m.marketAddress, { kinds: ["MINT_SET"], limit: 5 }).catch(e => []);
  if (!acts.length) continue;
  const pn = await pc.readContract({ address: m.marketAddress, abi: mkAbi, functionName: "payoutNumerators" });
  const win = pn[0] > pn[1] ? 0 : 1;
  const ot = await pc.readContract({ address: m.marketAddress, abi: mkAbi, functionName: "outcomeToken" });
  const winId = win === 0 ? BigInt(m.yesTokenId) : BigInt(m.noTokenId);
  for (const a of acts) {
    for (const cand of [a.yesTo, a.noTo, a.payer, a.holder].filter(Boolean)) {
      const bal = await pc.readContract({ address: ot, abi: e6909, functionName: "balanceOf", args: [cand, winId] });
      if (bal > 0n) {
        console.log("HOLDER", cand, "bal", bal.toString(), "market", m.marketId, m.asset, m.interval, "winIdx", win, "outcomeToken", ot, "key", marketKey(BigInt(m.yesTokenId)).toString());
        process.exit(0);
      }
    }
  }
}
console.log("no holder with live winning balance found");
process.exit(0);
