// Deploys Cross, FadeVault and (optionally) CrossReactor to Shannon, then writes addresses to .env.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { readFileSync, writeFileSync } from "node:fs";

const art = (n) => JSON.parse(readFileSync(new URL(`../out/${n}.json`, import.meta.url), "utf8"));
const env = process.env;
const account = privateKeyToAccount(env.PRIVATE_KEY);
const pc = createPublicClient({ chain: somniaShannon, transport: http(env.RPC_URL) });
const wc = createWalletClient({ account, chain: somniaShannon, transport: http(env.RPC_URL) });

const MODULE = env.BINARY_MODULE ?? SOMNIA_TESTNET_ADDRESSES.binaryModule;
const COLLATERAL = env.COLLATERAL ?? SOMNIA_TESTNET_ADDRESSES.collateral;
const SETTLEMENT = env.BINARY_SETTLEMENT ?? SOMNIA_TESTNET_ADDRESSES.binarySettlement;
const VENUE = env.VENUE_ID;

const balance = await pc.getBalance({ address: account.address });
console.log(`deployer ${account.address}`);
console.log(`balance  ${formatEther(balance)} STT`);
if (balance === 0n) {
  console.error("\nno STT. Fund the deployer before deploying.");
  process.exit(1);
}

async function deploy(name, args) {
  const { abi, bytecode } = art(name);
  const hash = await wc.deployContract({ abi, bytecode, args });
  const rec = await pc.waitForTransactionReceipt({ hash });
  if (rec.status !== "success") throw new Error(`${name} deploy reverted`);
  console.log(`${name.padEnd(13)} ${rec.contractAddress}  (gas ${rec.gasUsed})`);
  return rec.contractAddress;
}

const cross = await deploy("Cross", [MODULE, COLLATERAL, VENUE, 0]);
const vault = await deploy("FadeVault", [cross]);

// Caps sized for a testnet demo pool; raise them with setCaps once the vault is funded.
const VAULT_ABI = art("FadeVault").abi;
const one = 10n ** 6n;
const capTx = await wc.writeContract({
  address: vault,
  abi: VAULT_ABI,
  functionName: "setCaps",
  args: [500n * one, 2000n * one, 5000, 900_000],
});
await pc.waitForTransactionReceipt({ hash: capTx });
console.log("caps          maxStake 500, maxPerMarket 2000, maxUtil 50%, maxPrice 0.90");

let reactor = "";
if (env.DEPLOY_REACTOR === "true") {
  reactor = await deploy("CrossReactor", [cross, SETTLEMENT]);
  console.log("reactor deployed; fund it with 32 STT then call subscribe()");
}

const envPath = new URL("../.env", import.meta.url);
let text = readFileSync(envPath, "utf8");
const set = (k, v) => {
  text = text.match(new RegExp(`^${k}=.*$`, "m")) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
};
set("CROSS_ADDRESS", cross);
set("VAULT_ADDRESS", vault);
if (reactor) set("REACTOR_ADDRESS", reactor);
writeFileSync(envPath, text);
console.log("\naddresses written to .env");
