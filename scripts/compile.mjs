// Compiles contracts/*.sol with solc 0.8.30 into out/<Name>.json (abi + bytecode).
import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = join(root, "contracts");
const outDir = join(root, "out");

function collect(dir, prefix = "") {
  const sources = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) Object.assign(sources, collect(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".sol")) {
      sources[`${prefix}${entry.name}`] = { content: readFileSync(join(dir, entry.name), "utf8") };
    }
  }
  return sources;
}

const sources = collect(contractsDir);
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

// Imports are written relative to the importing file, so resolve them against the flat source map.
function findImport(path) {
  const base = path.replace(/^\.\//, "");
  if (sources[base]) return { contents: sources[base].content };
  const tail = base.split("/").pop();
  const hit = Object.keys(sources).find((k) => k.endsWith(tail));
  return hit ? { contents: sources[hit].content } : { error: `not found: ${path}` };
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));

let failed = false;
for (const err of output.errors ?? []) {
  if (err.severity === "error") {
    failed = true;
    console.error(err.formattedMessage);
  } else if (!/SPDX|Warning: Contract code size|unused/i.test(err.formattedMessage)) {
    console.warn(err.formattedMessage);
  }
}
if (failed) process.exit(1);

mkdirSync(outDir, { recursive: true });
let n = 0;
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, c] of Object.entries(contracts)) {
    if (!c.evm?.bytecode?.object) continue;
    writeFileSync(
      join(outDir, `${name}.json`),
      JSON.stringify({ name, file, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2),
    );
    const size = c.evm.deployedBytecode.object.length / 2;
    if (size > 0) console.log(`${name.padEnd(16)} ${String(size).padStart(6)} bytes`);
    n++;
  }
}
console.log(`compiled ${n} artifacts with solc ${solc.version()}`);
