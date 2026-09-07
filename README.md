# CROSS

**Two buyers. No seller. One window.**

CROSS turns dreamDEX's mint-a-pair fill path into a product: every 15-minute BTC or ETH
window becomes a head-to-head match with a guaranteed other side - a friend, a stranger, or
the Fade Vault - minted as a complete set and settled as a live race against the opening price.

Built for the Somnia x dreamDEX Event Contracts Hackathon, on Shannon testnet.

The mark is an up chevron and a down chevron locked through each other like two chain links:
each passes through the other exactly once, and neither can let go until the window settles.
The diamond left in the negative space is the window itself.

---

## Why this, on this venue

dreamDEX documents four fill paths, and one of them exists nowhere else in this product
category: **two opposite-side buyers can cross with no seller at all.** The pool mints a
fresh Up/Down pair from their combined collateral.

| Venue | Who is the other side? | What happens on a thin book |
| --- | --- | --- |
| CEX event contracts | The house | You can never *be* the house |
| Polymarket 15m | The CLOB, with taker fees | No depth, no fill |
| dreamDEX + CROSS | A named person, an open challenge, or the vault | `mintSet` needs no book at all |

Every CROSS match **mints new open interest** rather than consuming a young venue's
order-book depth. That is the cold-start problem a new CLOB actually has.

## The two sides

**Players.** Post "BTC UP, 20 tUSDC payout", share the link, and someone funds the other
half. The bet settles in 15 minutes, on chain, while you are both still in the conversation.
Payout is exact: you pay a price, the winner takes one.

**The Fade Vault.** Deposit and the vault becomes the counterparty to unmatched challenges,
but only when the offered price beats its own fair value by a required edge, and only inside
on-chain caps. Being the other side of directional flow is the one behaviour that reliably
makes money in short-horizon crypto up/down markets, and until now it required running your
own market-making bot. Here it is a deposit button.

The vault is not a yield product and makes no APY claim. It is underwriting PnL from taking
flow at a priced edge, and it can lose.

## How a match works

1. **Post.** Maker picks a side and a payout `N`. Stake is `N x price`, escrowed in `Cross`.
2. **Fill.** Taker (friend, open board, or vault) deposits `N - makerStake`.
3. **Mint.** `Cross` calls `mintSet(yesTo, noTo, N)` on the market's pool. The two stakes
   become one UP and one DOWN token. No order book is touched, so there is no slippage and
   no partial fill: the bet is exactly what the screen said.
4. **Race.** Both sides watch spot against the opening print with a clock.
5. **Settle.** The oracle resolves the window. Anyone can call `settle`, which finalizes the
   market if needed, redeems the winning leg through `BinaryMarketsModule.redeem`, and pays
   the winner. A voided window refunds each side its own stake exactly.

Settlement is permissionless by design, and reactivity is layered on top of it in two ways.

**Live: `somnia_watch`.** The solver holds a websocket subscription, so the node pushes
`ChallengePosted`, `Resolved` and `Voided` the block they land in and the solver acts on them
rather than waiting for its next poll. The polling loop stays as a heartbeat, because a dropped
socket must never mean an unsettled match. This needs no funding and it is running.

**Written but not deployed: `CrossReactor`.** The on-chain flavour subscribes through the
reactivity precompile so payout lands in the finalizing block with no off-chain process at all.
The precompile requires the subscribing contract itself to hold
`SUBSCRIPTION_OWNER_MINIMUM_BALANCE`, which is **32 STT**. Public faucets pay 0.1 STT a day, so
that floor is out of reach for a hackathon build, and the contract has never been deployed. It
compiles, it is included for review, and `DEPLOY_REACTOR=true` deploys it on a funded account.
Filed in the SDK feedback, since the floor makes on-chain reactivity unreachable for exactly the
developers a hackathon is trying to reach.

Either way the escrow does not depend on it: `settle` is callable by anyone, forever.

## Live

**App:** https://somniacross.vercel.app

## Deployed on Shannon

| | |
| --- | --- |
| Cross | `0x2a562ae9b47745b521e4fe9703a841f136af25f2` |
| FadeVault | `0x882751553e33a84b7f6caddbaef82421fd4c110f` |

## What is verified, and how

Four gates run against **live Shannon state** with no gas and no deployment, by running the
whole flow inside a single `eth_call` (a constructor that returns its observations):

```
npm install && npm run build && npm run simulate
```

```
market  BTC 15m
maker stake 58.00   taker stake 42.00   sum 100.00
cross holds UP      100.00
cross holds DOWN    100.00
cross idle collat   0.00
PASS  mint-from-contract works: both legs escrowed, nothing left over

vault committed 42.00 of a 1000 pool
PASS  the vault can be the counterparty with no order book involved
```

```
node scripts/dev/gate.mjs
PASS  escrow refuses to pay out an unresolved window

node scripts/dev/settlement-gate.mjs
PASS  the settlement record decodes identically in Solidity and in viem
```

That fourth gate exists because of a bug the first three could not reach.
`BinarySettlement.getSettlement` returns a **single struct**, not nine flat returns. The
tuple is dynamic, so a flat interface shifts every field by one word, hands the ABI decoder
`20000000` where it expects a `bool`, and reverts with empty data. `viem` decoded the same
record correctly throughout, so every diagnostic read looked healthy and only the on-chain
`settle` failed, after funds were already escrowed. The gate now decodes a real finalized
record through the production interface and compares it field by field against viem.

Two consequences worth naming:

- A fill-path test that stops at the resolution check cannot see a settlement-path bug.
  Gates have to reach the code they claim to cover.
- `claimLegs` now exists as a safety valve: two hours past expiry either participant can pull
  their own outcome token out of escrow and redeem it on dreamDEX directly, so a fault inside
  `settle` can never strand a match. It is trustless - no owner key can touch a position.

The full lifecycle runs on chain with `scripts/live-test.mjs`.

## Repo layout

```
contracts/
  Cross.sol            escrow, mint-a-pair fill, permissionless settlement
  FadeVault.sol        depositor pool that takes the other side, with on-chain risk caps
  CrossReactor.sol     on-chain reactivity handler; compiles, not deployed, see above
  sim/SimFill.sol      eth_call harnesses that prove the flow without gas
solver/
  pricing.mjs          digital-option fair value, realized vol, quoting
  market.mjs           live windows, opening prints, spot, vol
  index.mjs            vault quoter and settlement keeper
scripts/               compile, deploy, simulate, live-test
web/                   landing page plus the app, on Tailwind, Framer Motion and GSAP
docs/SDK-FEEDBACK.md   findings from building against the SDK
```

## Pricing, and why it is not 50/50

Once a window is open, the outcome is a digital option, not a coin flip. What matters is how
far spot has travelled from the opening print and how little time is left to undo it:

```
P(up) = N(d2),  d2 = (ln(S / S_open) - 0.5 * sigma^2 * T) / (sigma * sqrt(T))
```

Live, that reads:

```
15m  BTC spot 77759.99 vs open 77969.40 (-0.269%), 370s left, vol 28% -> fair UP 0.3%
4h   BTC spot 77759.99 vs open 78075.50 (-0.404%), 12070s left, vol 28% -> fair UP 23.3%
```

Same move, different windows. A vault that quoted 0.50 into the first line would be picked
off every time.

## Running it

```sh
pnpm install
pnpm build             # solc 0.8.30 -> out/*.json
pnpm gates             # five checks against live chain state, no gas needed
pnpm verify            # proves the deployed contracts are built from this source

# needs STT in the deployer wallet
pnpm deploy            # writes CROSS_ADDRESS and VAULT_ADDRESS into .env
node scripts/live-test.mjs   # full lifecycle on the soonest live window

cd web && pnpm install && cp .env.example .env.local   # paste the two addresses
pnpm dev
```

The solver runs dry by default:

```sh
DRY_RUN=false node solver/index.mjs
```

Deployment on Somnia is expensive: roughly 4,850 gas per byte of code, so `Cross` alone
costs about 0.33 STT to deploy. Budget for that before redeploying.

## Network

| | |
| --- | --- |
| Chain | Somnia Shannon, id 50312 |
| RPC | `https://api.infra.testnet.somnia.network` |
| Indexer | `https://dev.smk.somnia.host/v1/graphql` |
| Price feed | `https://price-feed.dev.oracle.somnia.host/v1/graphql` |
| Venue | `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` |
| Module | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Settlement | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| Collateral | tUSDC `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`, 6 decimals |

## Honest limits

- Testnet only, unaudited, educational code.
- Liquidity on day one is the vault's own capital. "Always fills" would be a lie; the vault
  fills when the line is inside its edge and it has room under its caps.
- The reactivity fast path needs the subscribing contract to hold 32 STT at subscribe time,
  which public faucets do not provide. Permissionless `settle` covers the same ground without it.
- Vol is estimated from one-minute feed candles and falls back to 60% annualized when the
  feed is thin.

MIT.
