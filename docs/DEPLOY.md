# Hosting the app

The front end is a static Vite build. Nothing server side, so any static host works.

## Vercel

Import the repository, then set:

| Setting | Value |
|---|---|
| Root directory | `web` |
| Framework preset | Vite |
| Build command | `vite build` |
| Output directory | `dist` |
| Install command | `npm install` (set in `web/vercel.json`) |

The install command is pinned to npm on purpose. pnpm refuses to finish an install while a
dependency's build script is unapproved, and esbuild trips that, which fails the deploy before
the build ever runs. `web/pnpm-workspace.yaml` answers it for local use, but the key differs by
pnpm version (`allowBuilds` from 11, `onlyBuiltDependencies` before it) and the host's version
is not ours to choose, so the hosted build takes the path that has actually been verified. esbuild only needs its postinstall on platforms without a prebuilt
binary, so npm installing it is not a compromise. Local development still uses pnpm; both
lockfiles are committed and `web/package-lock.json` exists solely to make the hosted build
reproducible.

Add two environment variables, both available at build time:

```
VITE_CROSS_ADDRESS=0x2a562ae9b47745b521e4fe9703a841f136af25f2
VITE_VAULT_ADDRESS=0x882751553e33a84b7f6caddbaef82421fd4c110f
```

Redeploy after changing them: Vite inlines `VITE_*` at build time, so a running deployment
will not pick up new values on its own.

## What the hosted app can and cannot do

It reads the indexer and the chain directly from the browser, so live windows, the vault
figures and the match list all work with no backend. Posting, taking and settling happen
through the visitor's own wallet on Somnia Shannon.

The Fade Vault only takes the other side of a challenge while the solver is running, and the
solver is a process, not part of the site. Without it the app still works, but an open
challenge waits for a human to take it. Run it wherever you like:

```sh
DRY_RUN=false node solver/index.mjs
```

## Contract ABIs

`web/src/abis.json` is generated from the compiler output and committed, so a hosted build
never needs the `out/` directory. Regenerate it after changing a contract:

```sh
node scripts/gen-abis.mjs
```
