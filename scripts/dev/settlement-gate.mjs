import "dotenv/config";
import { createPublicClient, http, decodeAbiParameters, encodeDeployData, parseAbiParameters, parseAbi } from "viem";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, marketKey } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync } from "node:fs";
import { syncChainTime, chainNow } from "../../lib/chain-time.mjs";
const art = n => JSON.parse(readFileSync(`out/${n}.json`,"utf8"));
const pc = createPublicClient({ chain: somniaShannon, transport: http(process.env.RPC_URL) });
const ex = new SomniaMarkets({ indexerUrl: process.env.INDEXER_URL, chain: somniaShannon, addresses: SOMNIA_TESTNET_ADDRESSES });
await syncChainTime(pc);
// The venue lists far more high frequency fixed-strike markets than reference ones, so a page
// of "past markets" contains none of the kind this gate needs. Ask the indexer for the exact
// shape instead: reference mode is strike 0, and only a finalized market has a payout vector.
const PAST_REFERENCE = `query($venue:String!,$now:numeric!){
  Market(where:{marketType:{_eq:"BINARY"},venueId:{_eq:$venue},strike:{_eq:"0"},expiry:{_lt:$now}},
         order_by:{expiry:desc}, limit:20){ id marketAddress poolAddress asset intervalSec expiry yesTokenId noTokenId }
}`;
const res = await fetch(process.env.INDEXER_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: PAST_REFERENCE, variables: { venue: process.env.VENUE_ID, now: chainNow() } }),
});
const past = (await res.json()).data?.Market ?? [];
if (!past.length) { console.log("no finalized reference market to read"); process.exit(1); }
const m = { ...past[0], marketId: past[0].id };
const key = marketKey(BigInt(m.yesTokenId));
// Ground truth via viem, which uses the SDK's own tuple ABI.
const setAbi = parseAbi(["function getSettlement(uint256 marketKey) view returns ((address collateralToken, uint128 backing, bool finalized, bool voided, uint256 settlementFeeBpsTimes1k, address feeRecipient, address pool, uint64 nonce, uint256[] payoutNumerators))"]);
const truth = await pc.readContract({ address: process.env.BINARY_SETTLEMENT, abi: setAbi, functionName: "getSettlement", args: [key] });
const { abi, bytecode } = art("SimSettlementRead");
const data = encodeDeployData({ abi, bytecode, args: [process.env.BINARY_SETTLEMENT, key] });
let sol;
try {
  const res = await pc.call({ account: process.env.DEPLOYER_ADDRESS, data });
  sol = decodeAbiParameters(parseAbiParameters("bool,bool,uint128,address,uint256[]"), res.data);
} catch (e) {
  console.log(`market ${m.asset} ${m.interval}, key ${key}`);
  console.log("FAIL  Solidity could not decode the settlement record:", (e.shortMessage||e.message).slice(0,140));
  process.exit(1);
}
const [finalized, voided, backing, coll, payout] = sol;
console.log(`market ${m.asset} ${m.interval}`);
console.log(`  viem     finalized=${truth.finalized} voided=${truth.voided} backing=${truth.backing} payout=${JSON.stringify(truth.payoutNumerators.map(String))}`);
console.log(`  solidity finalized=${finalized} voided=${voided} backing=${backing} payout=${JSON.stringify(payout.map(String))}`);
const ok = finalized === truth.finalized && voided === truth.voided && backing === truth.backing &&
  coll.toLowerCase() === truth.collateralToken.toLowerCase() &&
  JSON.stringify(payout.map(String)) === JSON.stringify(truth.payoutNumerators.map(String));
console.log(ok ? "\nPASS  the settlement record decodes identically in Solidity and in viem" : "\nFAIL  decode mismatch");
process.exit(ok ? 0 : 1);
