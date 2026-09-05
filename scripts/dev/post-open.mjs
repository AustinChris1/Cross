// Posts one open challenge so the solver has something real to find.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { readFileSync } from "node:fs";
import { syncChainTime, chainNow } from "../../lib/chain-time.mjs";

const CROSS = JSON.parse(readFileSync(new URL("../../out/Cross.json", import.meta.url), "utf8"));
const env = process.env;
const account = privateKeyToAccount(env.PRIVATE_KEY);
const pc = createPublicClient({ chain: somniaShannon, transport: http(env.RPC_URL) });
const wc = createWalletClient({ account, chain: somniaShannon, transport: http(env.RPC_URL) });
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function faucet(uint256)"]);

const ex = new SomniaMarkets({ indexerUrl: env.INDEXER_URL, chain: somniaShannon, wsRpcUrl: env.WS_RPC_URL, addresses: SOMNIA_TESTNET_ADDRESSES });
await syncChainTime(pc);
const now = chainNow();
const w = (await ex.client.listLiveBinaryMarkets({ limit: 40 }))
  .filter((x) => x.mode === "reference" && x.status === "Trading" && Number(x.expiry) - now > 420)
  .sort((a, b) => Number(a.expiry) - Number(b.expiry))[0];
if (!w) throw new Error("no window with enough time");

const bal = await pc.readContract({ address: env.COLLATERAL, abi: erc20, functionName: "balanceOf", args: [account.address] });
if (bal < 50n * 10n ** 6n) {
  const h = await wc.writeContract({ address: env.COLLATERAL, abi: erc20, functionName: "faucet", args: [1000n * 10n ** 6n] });
  await pc.waitForTransactionReceipt({ hash: h });
}
const ah = await wc.writeContract({ address: env.COLLATERAL, abi: erc20, functionName: "approve", args: [env.CROSS_ADDRESS, 2n ** 255n] });
await pc.waitForTransactionReceipt({ hash: ah });

// Deliberately generous to the taker so the vault's edge test passes.
const price = 700_000;
const h = await wc.writeContract({
  address: env.CROSS_ADDRESS,
  abi: CROSS.abi,
  functionName: "postChallenge",
  args: [w.marketId, 0, 20n * 10n ** 6n, price, "0x0000000000000000000000000000000000000000", 0],
});
const rec = await pc.waitForTransactionReceipt({ hash: h });
const id = await pc.readContract({ address: env.CROSS_ADDRESS, abi: CROSS.abi, functionName: "matchCount" });
console.log(`posted match #${id} on ${w.asset} ${w.interval}, UP at ${price / 1e6}, expires in ${Number(w.expiry) - now}s`);
console.log(`status ${rec.status}   link  #/m/${id}`);
