// The Fade Vault's quoter and the settlement keeper, in one loop.
// It never moves depositor funds anywhere except into a Cross match: the vault contract
// enforces every risk cap on chain, so a compromised solver can lose an edge, not the pool.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync } from "node:fs";
import { createExchange, fillableWindows, priceWindows } from "./market.mjs";
import { quote, describe } from "./pricing.mjs";

const art = (n) => JSON.parse(readFileSync(new URL(`../out/${n}.json`, import.meta.url), "utf8"));
const CROSS = art("Cross");
const VAULT = art("FadeVault");

const env = process.env;
const CROSS_ADDRESS = env.CROSS_ADDRESS;
const VAULT_ADDRESS = env.VAULT_ADDRESS;
const EDGE = Number(env.SOLVER_EDGE ?? 0.03);
const INTERVAL_MS = Number(env.SOLVER_INTERVAL_MS ?? 6000);
const SCAN = Number(env.SOLVER_SCAN ?? 60);
const DRY_RUN = env.DRY_RUN !== "false";

if (!CROSS_ADDRESS || !VAULT_ADDRESS) {
  console.error("set CROSS_ADDRESS and VAULT_ADDRESS in .env (run npm run deploy first)");
  process.exit(1);
}

const account = privateKeyToAccount(env.PRIVATE_KEY);
const pc = createPublicClient({ chain: somniaShannon, transport: http(env.RPC_URL) });
const wc = createWalletClient({ account, chain: somniaShannon, transport: http(env.RPC_URL) });
const ex = createExchange(env);

const State = { None: 0, Open: 1, Filled: 2, Settled: 3, Cancelled: 4 };
const dec = 6;
const fmt = (v) => Number(formatUnits(v, dec)).toFixed(2);

async function readMatches() {
  const count = Number(await pc.readContract({ address: CROSS_ADDRESS, abi: CROSS.abi, functionName: "matchCount" }));
  const from = Math.max(1, count - SCAN + 1);
  const out = [];
  for (let id = from; id <= count; id++) {
    const m = await pc.readContract({ address: CROSS_ADDRESS, abi: CROSS.abi, functionName: "getMatch", args: [BigInt(id)] });
    out.push({ id, ...m });
  }
  return out;
}

async function send(address, abi, functionName, args, label) {
  if (DRY_RUN) {
    console.log(`   [dry run] would ${label}`);
    return null;
  }
  try {
    await pc.simulateContract({ account, address, abi, functionName, args });
  } catch (e) {
    console.log(`   skip ${label}: ${(e.shortMessage ?? e.message).slice(0, 120)}`);
    return null;
  }
  const hash = await wc.writeContract({ address, abi, functionName, args });
  const rec = await pc.waitForTransactionReceipt({ hash });
  console.log(`   ${label} -> ${rec.status} ${hash}`);
  return rec;
}

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const windows = await fillableWindows(ex, env.VENUE_ID, now);
  const priced = await priceWindows(ex, windows, now);
  const byId = new Map(priced.map((p) => [p.market.marketId.toLowerCase(), p]));
  const matches = await readMatches();

  const open = matches.filter((m) => m.state === State.Open);
  const filled = matches.filter((m) => m.state === State.Filled);
  console.log(`\n[${new Date().toISOString()}] windows ${windows.length}  open ${open.length}  filled ${filled.length}`);

  for (const m of open) {
    const p = byId.get(m.marketId.toLowerCase());
    if (!p) {
      console.log(` #${m.id} market not fillable right now`);
      continue;
    }
    if (p.fairUp == null) {
      console.log(` #${m.id} no fair value yet (opening or spot missing)`);
      continue;
    }
    // The vault takes the side the maker did not.
    const vaultSide = m.makerSide === 0 ? "DOWN" : "UP";
    const askPrice = 1 - Number(m.price) / 1e6;
    const q = quote({ fairUp: p.fairUp, side: vaultSide, askPrice, edge: EDGE });
    const line = `${p.market.asset} ${p.market.interval}`;
    console.log(` #${m.id} ${line} maker ${m.makerSide === 0 ? "UP" : "DOWN"}@${(Number(m.price) / 1e6).toFixed(3)} -> vault ${vaultSide}@${askPrice.toFixed(3)}`);
    console.log(`     ${describe({ asset: p.market.asset, spot: p.spot, opening: p.opening, secondsLeft: p.secondsLeft, vol: p.vol, fairUp: p.fairUp })}`);
    console.log(`     fair ${vaultSide} ${q.fair.toFixed(3)}  limit ${q.limit.toFixed(3)}  edge ${(q.edgeCaptured * 100).toFixed(1)}pts  ${q.acceptable ? "TAKE" : "pass"}`);
    if (q.acceptable) {
      await send(VAULT_ADDRESS, VAULT.abi, "fade", [BigInt(m.id)], `fade #${m.id} for ${fmt(m.contracts - m.makerStake)}`);
    }
  }

  const ready = [];
  for (const m of filled) {
    const resolved = await pc
      .readContract({ address: m.market, abi: [{ type: "function", name: "isResolved", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" }], functionName: "isResolved" })
      .catch(() => false);
    const voided = await pc
      .readContract({ address: m.market, abi: [{ type: "function", name: "isVoided", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" }], functionName: "isVoided" })
      .catch(() => false);
    if (resolved || voided) ready.push(BigInt(m.id));
  }
  if (ready.length) {
    console.log(` settling ${ready.length} resolved match(es): ${ready.join(", ")}`);
    await send(CROSS_ADDRESS, CROSS.abi, "settleMany", [ready], `settleMany ${ready.length}`);
    await send(VAULT_ADDRESS, VAULT.abi, "releaseMany", [ready], `release ${ready.length}`);
  }
}

console.log(`CROSS solver
  cross    ${CROSS_ADDRESS}
  vault    ${VAULT_ADDRESS}
  quoter   ${account.address}
  edge     ${EDGE}
  mode     ${DRY_RUN ? "DRY RUN (set DRY_RUN=false to send)" : "LIVE"}`);

await tick();
setInterval(() => tick().catch((e) => console.error("tick failed:", e.shortMessage ?? e.message)), INTERVAL_MS);
