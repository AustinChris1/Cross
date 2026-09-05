// Writes the ABIs the front end needs into web/src/abis.json, committed so a hosted build
// does not depend on the compiler output directory. Bytecode is dropped: the app only reads
// and writes through these contracts, it never deploys them.
import { readFileSync, writeFileSync } from "node:fs";

const pick = ["Cross", "FadeVault"];
const out = {};
for (const name of pick) {
  const art = JSON.parse(readFileSync(new URL(`../out/${name}.json`, import.meta.url), "utf8"));
  out[name] = art.abi;
}
const path = new URL("../web/src/abis.json", import.meta.url);
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
const bytes = JSON.stringify(out).length;
console.log(`wrote web/src/abis.json (${pick.join(", ")}, ${(bytes / 1024).toFixed(1)} kB, no bytecode)`);
