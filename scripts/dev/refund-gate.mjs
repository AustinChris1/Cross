// Gasless gate for the refund paths: an unmatched challenge must return the maker's stake
// exactly, only the maker may cancel, and cancelling twice must not pay twice.
import "dotenv/config";
import { createPublicClient, http, encodeDeployData, decodeAbiParameters, formatUnits } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync } from "node:fs";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { syncChainTime, chainNow } from "../../lib/chain-time.mjs";

const art = JSON.parse(readFileSync(new URL("../../out/SimRefund.json", import.meta.url), "utf8"));
const env = process.env;
const pc = createPublicClient({ chain: somniaShannon, transport: http(env.RPC_URL) });

const RESULT = [
  {
    type: "tuple",
    components: [
      { name: "stakeBefore", type: "uint256" },
      { name: "afterCancel", type: "uint256" },
      { name: "stateAfterCancel", type: "uint8" },
      { name: "cancelTwiceReverted", type: "bool" },
      { name: "strangerCancelReverted", type: "bool" },
    ],
  },
];

const ex = new SomniaMarkets({
  indexerUrl: env.INDEXER_URL,
  chain: somniaShannon,
  wsRpcUrl: env.WS_RPC_URL,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
await syncChainTime(pc);
const now = chainNow();
const w = (await ex.client.listLiveBinaryMarkets({ limit: 40, nowSec: now }))
  .filter((x) => x.mode === "reference" && x.status === "Trading" && Number(x.expiry) - now > 360)
  .sort((a, b) => Number(a.expiry) - Number(b.expiry))[0];
if (!w) throw new Error("no live window with enough time left");
console.log(`window   ${w.asset} ${w.interval}  expires in ${Number(w.expiry) - now}s`);

const contracts = 20n * 10n ** 6n;
const price = 550_000;
const data = encodeDeployData({
  abi: art.abi,
  bytecode: art.bytecode,
  args: [env.BINARY_MODULE, env.COLLATERAL, env.VENUE_ID, 0, w.marketId, contracts, price],
});
const { data: raw } = await pc.call({ account: env.DEPLOYER_ADDRESS, data });
const [r] = decodeAbiParameters(RESULT, raw);

const f = (x) => Number(formatUnits(x, 6)).toFixed(2);
const expectedStake = (contracts * BigInt(price)) / 1_000_000n;
const refundedExactly = r.afterCancel >= expectedStake;

console.log(`\n  staked on post      ${f(r.stakeBefore)}  (expected ${f(expectedStake)})`);
console.log(`  balance after cancel ${f(r.afterCancel)}`);
console.log(`  state after cancel   ${r.stateAfterCancel} (4 = Cancelled)`);
console.log(`  stranger cancel      ${r.strangerCancelReverted ? "rejected" : "ALLOWED"}`);
console.log(`  double cancel        ${r.cancelTwiceReverted ? "rejected" : "ALLOWED"}`);

const ok =
  r.stakeBefore === expectedStake &&
  refundedExactly &&
  r.stateAfterCancel === 4 &&
  r.cancelTwiceReverted &&
  r.strangerCancelReverted;

console.log(
  ok
    ? "\nPASS  an unmatched challenge refunds the maker exactly, and only the maker"
    : "\nFAIL  see values above",
);
process.exit(ok ? 0 : 1);
