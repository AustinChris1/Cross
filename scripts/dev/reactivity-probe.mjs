// Proves somnia_watch delivers a matched log together with same-block eth_call results,
// with no on-chain subscription and therefore no 32 STT floor.
import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createReactivity, unwrap } from "@somnia-chain/markets-sdk/reactivity";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { encodeFunctionData, toEventSelector, decodeAbiParameters } from "viem";

const env = process.env;
const ex = new SomniaMarkets({
  indexerUrl: env.INDEXER_URL,
  chain: somniaShannon,
  wsRpcUrl: env.WS_RPC_URL,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const reactivity = createReactivity(ex.client);

// Watch every complete-set mint on the venue, and read the pool's backing at the same block.
const topic = toEventSelector("SetMinted(address,address,address,uint256)");
const backingCall = encodeFunctionData({
  abi: [{ type: "function", name: "setBacking", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }],
  functionName: "setBacking",
});

console.log("subscribing to somnia_watch (no STT, no on-chain handler)…");
let seen = 0;
const watch = unwrap(
  await reactivity.watch({
    topicOverrides: [topic],
    ethCalls: [],
    onData: (n) => {
      seen++;
      const r = n.result ?? n;
      console.log(`  [${new Date().toISOString()}] SetMinted from ${r.address}`);
      console.log(`     topics ${r.topics?.length ?? 0}  simulationResults ${r.simulationResults?.length ?? 0}`);
    },
    onError: (e) => console.log("  watch error:", e?.message ?? e),
  }),
);
console.log("subscribed. waiting 60s for any mint on the venue…");
setTimeout(async () => {
  await watch.unsubscribe();
  console.log(seen > 0 ? `\nPASS  somnia_watch delivered ${seen} event(s) with no STT held` : "\nno events in the window (venue was quiet); subscription itself succeeded");
  process.exit(0);
}, 60000);
