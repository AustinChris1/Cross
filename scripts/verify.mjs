// Proves the source in this repo is the code running on Shannon. Immutable values are written
// into the runtime code at deploy time, so those byte ranges are masked before comparing.
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { readFileSync } from "node:fs";

const pc = createPublicClient({ chain: somniaShannon, transport: http(process.env.RPC_URL) });

function mask(hex, refs) {
  const bytes = Buffer.from(hex.slice(2), "hex");
  for (const slots of Object.values(refs ?? {})) {
    for (const { start, length } of slots) bytes.fill(0, start, start + length);
  }
  return bytes.toString("hex");
}

let ok = true;
for (const [name, address] of [
  ["Cross", process.env.CROSS_ADDRESS],
  ["FadeVault", process.env.VAULT_ADDRESS],
]) {
  const art = JSON.parse(readFileSync(new URL(`../out/${name}.json`, import.meta.url), "utf8"));
  const onchain = await pc.getCode({ address });
  const a = mask(onchain, art.immutableReferences);
  const b = mask(art.deployedBytecode, art.immutableReferences);
  const same = a === b;
  if (!same) ok = false;
  const immutables = Object.keys(art.immutableReferences ?? {}).length;
  console.log(
    `  ${name.padEnd(10)} ${same ? "matches" : "DIFFERS"}  ${(onchain.length - 2) / 2} bytes on chain, ${immutables} immutable(s) masked  ${address}`,
  );
}
console.log(ok ? "\nPASS  the deployed contracts are built from this source" : "\nFAIL  source has drifted from the deployment");
process.exit(ok ? 0 : 1);
