# CROSS

**Two buyers. No seller. One window.**

CROSS turns dreamDEX's mint-a-pair fill path into a product: every 15-minute BTC or ETH
window becomes a head-to-head match with a guaranteed other side - a friend, a stranger, or
the Fade Vault - minted as a complete set and settled as a live race against the opening price.

Built for the Somnia x dreamDEX Event Contracts Hackathon, on Shannon testnet.

The mark is an up tick and a down tick sharing one vertex: the moment two opposite buyers
cross and the pool mints a pair. The shared vertex is the fill.

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

Settlement is permissionless by design. `CrossReactor` additionally subscribes to
`BinarySettlement.MarketFinalized` through Somnia's reactivity precompile so payout can land
in the same block the market finalizes, with no keeper and no user click. The reactor is
strictly additive: if it is unfunded or unsubscribed, `settle` still works for anyone.

## What is verified, and how

Three gates run against **live Shannon state** with no gas and no deployment, by running the
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

and `node scripts/dev/gate.mjs`:

```
settle before resolution reverted: true, selector matches NotResolved
PASS  escrow refuses to pay out an unresolved window
```

The redeem-after-finalize path needs real transactions, because every finalized market on
Shannon shows `backing: 0` - the venue's own bots redeem promptly, so there is no borrowable
winning position to simulate against. `scripts/live-test.mjs` runs that full lifecycle on a
5-minute window once the deployer holds STT.

## Repo layout

```
contracts/
  Cross.sol            escrow, mint-a-pair fill, permissionless settlement
  FadeVault.sol        depositor pool that takes the other side, with on-chain risk caps
  CrossReactor.sol     reactivity subscription that settles in the finalizing block
  sim/SimFill.sol      eth_call harnesses that prove the flow without gas
solver/
  pricing.mjs          digital-option fair value, realized vol, quoting
  market.mjs           live windows, opening prints, spot, vol
  index.mjs            vault quoter and settlement keeper
scripts/               compile, deploy, simulate, live-test
web/                   the app: match view, live windows, vault dashboard
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
npm install
npm run build          # solc 0.8.30 -> out/*.json
npm run simulate       # proves the fill path against live chain state, no gas needed

# needs STT in the deployer wallet
npm run deploy         # writes CROSS_ADDRESS and VAULT_ADDRESS into .env
node scripts/live-test.mjs   # full lifecycle on a 5m window

cd web && cp .env.example .env.local   # paste the two addresses
npm run dev
```

The solver runs dry by default:

```sh
DRY_RUN=false node solver/index.mjs
```

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
