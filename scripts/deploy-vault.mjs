// Redeploys only FadeVault against the existing Cross, then writes the address to .env.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync, writeFileSync } from "node:fs";

const art = JSON.parse(readFileSync(new URL("../out/FadeVault.json", import.meta.url), "utf8"));
const env = process.env;
const account = privateKeyToAccount(env.PRIVATE_KEY);
const pc = createPublicClient({ chain: somniaShannon, transport: http(env.RPC_URL) });
const wc = createWalletClient({ account, chain: somniaShannon, transport: http(env.RPC_URL) });

console.log(`deployer ${account.address}`);
console.log(`balance  ${formatEther(await pc.getBalance({ address: account.address }))} STT`);
console.log(`cross    ${env.CROSS_ADDRESS}`);

const hash = await wc.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [env.CROSS_ADDRESS] });
const rec = await pc.waitForTransactionReceipt({ hash });
if (rec.status !== "success") throw new Error("vault deploy reverted");
console.log(`FadeVault ${rec.contractAddress}  (gas ${rec.gasUsed})`);

const one = 10n ** 6n;
const capTx = await wc.writeContract({
  address: rec.contractAddress,
  abi: art.abi,
  functionName: "setCaps",
  args: [500n * one, 2000n * one, 5000, 900_000],
});
await pc.waitForTransactionReceipt({ hash: capTx });
console.log("caps      maxStake 500, maxPerMarket 2000, maxUtil 50%, maxPrice 0.90");

const envPath = new URL("../.env", import.meta.url);
let text = readFileSync(envPath, "utf8");
text = text.replace(/^VAULT_ADDRESS=.*$/m, `VAULT_ADDRESS=${rec.contractAddress}`);
writeFileSync(envPath, text);
console.log(`\nbalance left ${formatEther(await pc.getBalance({ address: account.address }))} STT`);
