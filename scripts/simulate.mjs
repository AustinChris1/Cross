// Runs the whole match flow against live Shannon state inside one eth_call. No gas, no deploy.
import "dotenv/config";
import { createPublicClient, http, decodeAbiParameters, encodeDeployData, parseAbiParameters } from "viem";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const art = (n) => JSON.parse(readFileSync(join(root, "out", `${n}.json`), "utf8"));

const RPC = process.env.RPC_URL ?? "https://api.infra.testnet.somnia.network";
const INDEXER = process.env.INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql";
const VENUE = process.env.VENUE_ID ?? "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
const MODULE = process.env.BINARY_MODULE ?? SOMNIA_TESTNET_ADDRESSES.binaryModule;
const COLLATERAL = process.env.COLLATERAL ?? SOMNIA_TESTNET_ADDRESSES.collateral;
const CALLER = process.env.DEPLOYER_ADDRESS ?? "0x0000000000000000000000000000000000000001";

const pc = createPublicClient({ chain: somniaShannon, transport: http(RPC) });
const ex = new SomniaMarkets({ indexerUrl: INDEXER, chain: somniaShannon, addresses: SOMNIA_TESTNET_ADDRESSES });

const RESULT_FILL = parseAbiParameters(
  "(address cross,uint256 matchId,uint128 makerStake,uint128 takerStake,uint256 crossYes,uint256 crossNo,uint256 crossIdle,uint8 state,uint64 poolNonce,uint8 marketStatus)",
);
const RESULT_VAULT = parseAbiParameters(
  "(address cross,address vault,uint256 matchId,uint256 vaultShares,uint256 vaultCommitted,uint256 vaultTotalAssets,uint256 crossYes,uint256 crossNo,uint8 state)",
);

async function pickMarket() {
  const now = Math.floor(Date.now() / 1000);
  const live = await ex.client.listLiveBinaryMarkets({ limit: 40 });
  const usable = live
    .filter((m) => m.mode === "reference" && m.venueId?.toLowerCase() === VENUE.toLowerCase())
    .filter((m) => m.status === "Trading" && Number(m.expiry) - now > 360)
    .sort((a, b) => Number(a.expiry) - Number(b.expiry));
  if (!usable.length) throw new Error("no reference-mode market with enough headroom right now");
  return usable[0];
}

async function simulate(name, args, resultAbi) {
  const { abi, bytecode } = art(name);
  const data = encodeDeployData({ abi, bytecode, args });
  const res = await pc.call({ account: CALLER, data });
  return decodeAbiParameters(resultAbi, res.data)[0];
}

const m = await pickMarket();
const secs = Number(m.expiry) - Math.floor(Date.now() / 1000);
const dec = m.quoteDecimals ?? 6;
const one = 10 ** dec;
const contracts = BigInt(100 * one); // 100 collateral units of payout
const price = 580_000; // maker pays 0.58

console.log(`market  ${m.asset} ${m.interval}  id ${m.marketId}`);
console.log(`window  expires in ${secs}s  status ${m.status}  pool ${m.poolAddress}`);
console.log(`stake   payout 100, maker price 0.58\n`);

const fill = await simulate("SimFill", [MODULE, COLLATERAL, VENUE, 0, m.marketId, contracts, price], RESULT_FILL);
const f = (v) => (Number(v) / one).toFixed(2);
console.log("--- head to head fill ---");
console.log(`cross deployed at   ${fill.cross}`);
console.log(`maker stake         ${f(fill.makerStake)}   taker stake ${f(fill.takerStake)}   sum ${f(fill.makerStake + fill.takerStake)}`);
console.log(`cross holds UP      ${f(fill.crossYes)}`);
console.log(`cross holds DOWN    ${f(fill.crossNo)}`);
console.log(`cross idle collat   ${f(fill.crossIdle)}   (0 means every unit was minted into the pair)`);
console.log(`match state         ${fill.state} (2 = Filled)   pool nonce ${fill.poolNonce}   market status ${fill.marketStatus}`);

const ok =
  fill.crossYes === contracts &&
  fill.crossNo === contracts &&
  fill.crossIdle === 0n &&
  fill.state === 2 &&
  fill.makerStake + fill.takerStake === contracts;
console.log(ok ? "\nPASS  mint-from-contract works: both legs escrowed, nothing left over" : "\nFAIL  see values above");

const vault = await simulate(
  "SimVaultFill",
  [MODULE, COLLATERAL, VENUE, 0, m.marketId, contracts, price, BigInt(1000 * one)],
  RESULT_VAULT,
);
console.log("\n--- vault fade fill ---");
console.log(`vault at            ${vault.vault}`);
console.log(`deposit 1000 -> shares ${f(vault.vaultShares)}   totalAssets ${f(vault.vaultTotalAssets)}`);
console.log(`committed to match  ${f(vault.vaultCommitted)}   (the 0.42 side of a 100 payout)`);
console.log(`cross holds UP/DOWN ${f(vault.crossYes)} / ${f(vault.crossNo)}   state ${vault.state}`);
const okV = vault.crossYes === contracts && vault.crossNo === contracts && vault.state === 2;
console.log(okV ? "\nPASS  the vault can be the counterparty with no order book involved" : "\nFAIL  see values above");

process.exit(ok && okV ? 0 : 1);
