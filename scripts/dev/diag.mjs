import "dotenv/config";
import { createPublicClient, http, parseAbi, formatUnits, decodeErrorResult } from "viem";
import { readFileSync } from "node:fs";
const CROSS = JSON.parse(readFileSync("out/Cross.json","utf8"));
const pc = createPublicClient({ transport: http(process.env.RPC_URL) });
const cross = process.env.CROSS_ADDRESS;
const m = await pc.readContract({ address: cross, abi: CROSS.abi, functionName: "getMatch", args: [1n] });
const f = v => Number(formatUnits(v,6)).toFixed(2);
console.log("match#1 state", m.state, "market", m.market, "pool", m.pool);
console.log("  maker", m.maker, "taker", m.taker);
console.log("  contracts", f(m.contracts), "makerStake", f(m.makerStake), "side", m.makerSide, "expiry", m.expiry, "now", Math.floor(Date.now()/1000));
const mk = parseAbi(["function status() view returns (uint8)","function isResolved() view returns (bool)","function isVoided() view returns (bool)","function payoutNumerators() view returns (uint256[])","function outcomeToken() view returns (address)"]);
for (const fn of ["status","isResolved","isVoided","payoutNumerators","outcomeToken"]) {
  try { console.log(" market."+fn, String(await pc.readContract({address:m.market,abi:mk,functionName:fn}))); } catch(e){ console.log(" market."+fn,"ERR",e.shortMessage); }
}
const setAbi = parseAbi(["function getSettlement(uint256 marketKey) view returns ((address collateralToken, uint128 backing, bool finalized, bool voided, uint256 settlementFeeBpsTimes1k, address feeRecipient, address pool, uint64 nonce, uint256[] payoutNumerators))"]);
const key = BigInt(m.yesId) >> 8n;
const rec = await pc.readContract({ address: process.env.BINARY_SETTLEMENT, abi: setAbi, functionName: "getSettlement", args: [key] });
console.log(" settlement.finalized", rec.finalized, "voided", rec.voided, "backing", rec.backing.toString(), "payout", JSON.stringify(rec.payoutNumerators.map(String)));
const e6909 = parseAbi(["function balanceOf(address owner,uint256 id) view returns (uint256)","function isOperator(address owner,address spender) view returns (bool)"]);
const ot = await pc.readContract({address:m.market,abi:mk,functionName:"outcomeToken"});
console.log(" cross holds UP", f(await pc.readContract({address:ot,abi:e6909,functionName:"balanceOf",args:[cross,BigInt(m.yesId)]})));
console.log(" cross holds DOWN", f(await pc.readContract({address:ot,abi:e6909,functionName:"balanceOf",args:[cross,BigInt(m.noId)]})));
console.log(" module isOperator for cross", await pc.readContract({address:ot,abi:e6909,functionName:"isOperator",args:[cross,process.env.BINARY_MODULE]}));
try {
  await pc.simulateContract({ account: process.env.DEPLOYER_ADDRESS, address: cross, abi: CROSS.abi, functionName: "settle", args: [1n] });
  console.log("\nsimulate settle: OK");
} catch (e) {
  console.log("\nsimulate settle REVERT:", (e.shortMessage||e.message).slice(0,200));
  const data = e.walk?.(x=>x?.data)?.data ?? e.cause?.data;
  if (data) { try { console.log("decoded:", JSON.stringify(decodeErrorResult({ abi: CROSS.abi, data }))); } catch { console.log("raw revert data:", data); } }
  const meta = e.metaMessages?.slice(0,4).join(" | "); if (meta) console.log("meta:", meta.slice(0,300));
}
