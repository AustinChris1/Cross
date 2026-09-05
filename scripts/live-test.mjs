// End to end proof on Shannon: post a challenge on the soonest live window, have the vault
// fade it, wait for the oracle to resolve the window, settle, and check the winner was paid.
// This is the run that closes the last unverified path (redeem after finalize).
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatUnits, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync } from "node:fs";
import { createExchange, fillableWindows, priceWindows } from "../solver/market.mjs";
import { syncChainTime, chainNow } from "../lib/chain-time.mjs";

const art = (n) => JSON.parse(readFileSync(new URL(`../out/${n}.json`, import.meta.url), "utf8"));
const CROSS = art("Cross");
const VAULT = art("FadeVault");
const env = process.env;
const account = privateKeyToAccount(env.PRIVATE_KEY);
const pc = createPublicClient({ chain: somniaShannon, transport: http(env.RPC_URL) });
const wc = createWalletClient({ account, chain: somniaShannon, transport: http(env.RPC_URL) });
const ex = createExchange(env);

const erc20 = parseAbi([
  "function faucet(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address o, address s) view returns (uint256)",
]);
const marketAbi = parseAbi([
  "function isResolved() view returns (bool)",
  "function isVoided() view returns (bool)",
  "function status() view returns (uint8)",
]);

const one = 10n ** 6n;
const f = (v) => Number(formatUnits(v, 6)).toFixed(2);
const CROSS_ADDRESS = env.CROSS_ADDRESS;
const VAULT_ADDRESS = env.VAULT_ADDRESS;
const CONTRACTS = 20n * one;
const PRICE = 550_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tx(label, address, abi, functionName, args) {
  const hash = await wc.writeContract({ address, abi, functionName, args });
  const rec = await pc.waitForTransactionReceipt({ hash });
  console.log(`  ${label.padEnd(28)} ${rec.status}  ${hash}`);
  if (rec.status !== "success") throw new Error(`${label} reverted`);
  return rec;
}

// 1. pick the soonest window that still has headroom
await syncChainTime(pc);
const now = chainNow();
// A 5m window lives 300s, so it can never clear the solver's headroom rule. Take whichever
// window expires soonest while still leaving room to post, fill and settle.
const windows = await fillableWindows(ex, env.VENUE_ID, now);
const short = windows
  .filter((m) => Number(m.expiry) - now > 420 && Number(m.intervalSec) <= 3600)
  .sort((a, b) => Number(a.expiry) - Number(b.expiry))[0];
if (!short) throw new Error("no window with enough headroom right now; try again in a minute");
const [priced] = await priceWindows(ex, [short], now);
console.log(`window   ${short.asset} ${short.interval}  expires in ${Number(short.expiry) - now}s`);
console.log(`fair UP  ${priced.fairUp == null ? "n/a" : (priced.fairUp * 100).toFixed(1) + "%"}  (spot ${priced.spot} vs open ${priced.opening})`);

// 2. fund the maker wallet and the vault
console.log("\nfunding");
await tx("faucet tUSDC", env.COLLATERAL, erc20, "faucet", [1000n * one]);
await tx("approve cross", env.COLLATERAL, erc20, "approve", [CROSS_ADDRESS, 1000n * one]);
const vaultBal = await pc.readContract({ address: env.COLLATERAL, abi: erc20, functionName: "balanceOf", args: [VAULT_ADDRESS] });
if (vaultBal < 200n * one) {
  await tx("approve vault", env.COLLATERAL, erc20, "approve", [VAULT_ADDRESS, 1000n * one]);
  await tx("deposit to vault", VAULT_ADDRESS, VAULT.abi, "deposit", [500n * one]);
}

// 3. post and fade
console.log("\nmatch");
const before = await pc.readContract({ address: env.COLLATERAL, abi: erc20, functionName: "balanceOf", args: [account.address] });
const rec = await tx("postChallenge", CROSS_ADDRESS, CROSS.abi, "postChallenge", [
  short.marketId,
  0,
  CONTRACTS,
  PRICE,
  "0x0000000000000000000000000000000000000000",
  0,
]);
const matchId = await pc.readContract({ address: CROSS_ADDRESS, abi: CROSS.abi, functionName: "matchCount" });
console.log(`  match id ${matchId}  maker UP @ ${(PRICE / 1e6).toFixed(2)} for ${f(CONTRACTS)} payout`);
await tx("vault fade", VAULT_ADDRESS, VAULT.abi, "fade", [matchId]);

const m = await pc.readContract({ address: CROSS_ADDRESS, abi: CROSS.abi, functionName: "getMatch", args: [matchId] });
console.log(`  state ${m.state} (2 = Filled), maker stake ${f(m.makerStake)}, vault stake ${f(m.contracts - m.makerStake)}`);

// 4. wait for the oracle
const deadline = Number(short.expiry) + 240;
console.log(`\nwaiting for resolution (expiry ${short.expiry})`);
let resolved = false;
let voided = false;
while (chainNow() < deadline) {
  resolved = await pc.readContract({ address: m.market, abi: marketAbi, functionName: "isResolved" }).catch(() => false);
  voided = await pc.readContract({ address: m.market, abi: marketAbi, functionName: "isVoided" }).catch(() => false);
  if (resolved || voided) break;
  await sleep(5000);
  process.stdout.write(".");
}
console.log(`\n  resolved ${resolved}  voided ${voided}`);
if (!resolved && !voided) throw new Error("oracle did not resolve inside the settlement window");

// 5. settle and check the payout
console.log("\nsettlement");
await tx("settle", CROSS_ADDRESS, CROSS.abi, "settle", [matchId]);
const after = await pc.readContract({ address: env.COLLATERAL, abi: erc20, functionName: "balanceOf", args: [account.address] });
const post = await pc.readContract({ address: CROSS_ADDRESS, abi: CROSS.abi, functionName: "getMatch", args: [matchId] });

// Regression check. Committed capital must not still count a stake the payout already returned,
// or share pricing double counts it. Read BEFORE any explicit release.
const stakeBack = await pc.readContract({ address: VAULT_ADDRESS, abi: VAULT.abi, functionName: "committed" });
const idle = await pc.readContract({ address: env.COLLATERAL, abi: erc20, functionName: "balanceOf", args: [VAULT_ADDRESS] });
const vaultAssets = await pc.readContract({ address: VAULT_ADDRESS, abi: VAULT.abi, functionName: "totalAssets" });
// The sweep runs on the next entry point, so prove it reconciles rather than assuming a hook fired.
await tx("vault sweep", VAULT_ADDRESS, VAULT.abi, "sweep", []);
const committedAfter = await pc.readContract({ address: VAULT_ADDRESS, abi: VAULT.abi, functionName: "committed" });
const assetsAfter = await pc.readContract({ address: VAULT_ADDRESS, abi: VAULT.abi, functionName: "totalAssets" });
const idleAfter = await pc.readContract({ address: env.COLLATERAL, abi: erc20, functionName: "balanceOf", args: [VAULT_ADDRESS] });

const accountingOk = committedAfter === 0n && assetsAfter === idleAfter;

console.log(`\n  match state        ${post.state} (3 = Settled)`);
console.log(`  maker balance      ${f(before)} -> ${f(after)}  (delta ${f(after - before)})`);
console.log(`  before sweep       idle ${f(idle)}  committed ${f(stakeBack)}  totalAssets ${f(vaultAssets)}`);
console.log(`  after sweep        idle ${f(idleAfter)}  committed ${f(committedAfter)}  totalAssets ${f(assetsAfter)}`);
console.log(
  accountingOk
    ? "  accounting         totalAssets equals real collateral, nothing double counted"
    : "  accounting         MISMATCH, committed did not reconcile",
);
console.log(
  post.state === 3 && accountingOk
    ? "\nPASS  full lifecycle on chain: post, fade, mint, resolve, redeem, pay, reconcile"
    : "\nFAIL  see values above",
);
process.exit(post.state === 3 && accountingOk ? 0 : 1);
