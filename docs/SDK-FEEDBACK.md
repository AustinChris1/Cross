# SDK and documentation feedback

Findings from building CROSS against `@somnia-chain/markets-sdk` 0.29.0 on Shannon, in the
order they cost us time. Every item is reproducible with the scripts in this repo.

## 1. `getLivePrice(asset)` can return a feed that died 42 days ago

The highest-cost issue. The price-feed indexer carries more than one `Feed` row per base
asset, and the SDK's per-asset lookup resolves by base symbol. On Shannon the `BTC/USDT` and
`ETH/USDT` rows are stale by ~3.6 million seconds while `BTC/USDC` and `ETH/USDC` are live:

```
BTC/USDT  spot 66757.75   age 3622306s
BTC/USDC  spot 77899.34   age 0s
```

`client.getLivePrice("BTC")` and `client.fetchPrice("BTC")` both returned the dead USDT row.
Nothing in the returned object is obviously wrong: `price` is a plausible number and
`decimals` is correct. The only tell is `blockTimestamp`, which a caller has to think to
check. Any oracle-follow strategy built the obvious way will price windows off a 42-day-old
spot and quote confidently into a market that has moved 15%.

Suggestions, cheapest first:
- Make the per-asset reads prefer the freshest row, or the venue's collateral quote.
- Expose a `quote` argument (`getLivePrice("BTC", { quote: "USDC" })`).
- Return `ageMs` alongside `price`, or warn when the chosen row is older than the feed's
  own cadence.

Reproduce: `node scripts/dev/feed2.mjs`.

## 2. `getSettlement` returns one struct, and a flat interface fails silently

This cost a deployment. `binarySettlementAbi` declares:

```
function getSettlement(uint256 marketKey) view returns ((address collateralToken, uint128
  backing, bool finalized, bool voided, uint256 settlementFeeBpsTimes1k, address feeRecipient,
  address pool, uint64 nonce, uint256[] payoutNumerators))
```

Those are the field names of a **single struct**, but written in the parenthesised form they
read exactly like a multi-value return. A Solidity interface written the natural way:

```solidity
function getSettlement(uint256 marketKey) external view
    returns (address collateralToken, uint128 backing, bool finalized, ...);
```

compiles, matches the same 4-byte selector, and is wrong. The tuple is dynamic because of
`payoutNumerators`, so the return data begins with an offset word. A flat decode shifts every
field by one: `finalized` lands on `backing`'s slot, the decoder is handed `20000000` where it
expects a bool, and the call reverts with **empty return data**. No revert string, no custom
error, no selector - just `0x`.

Everything around it looked healthy. `viem`, using the SDK's own ABI, decoded the record
perfectly, so every diagnostic read said `finalized: true, backing: 20000000`. Only the
on-chain call failed, and only at settlement time, after real money was escrowed.

Suggestions:
- Name the struct in the exported ABI (`IBinarySettlement.Record`) so the shape is unambiguous.
- Ship the interfaces as `.sol` files alongside the TypeScript ABIs. Contract integrators are
  a first-class audience here, and the SDK is currently the only source of truth for them.
- A one-line note on the settlement docs page: *this returns a struct, not a tuple of returns.*

## 3. Oracle answers are 2-decimal, the price feed is 18-decimal

`getOpeningPrices` returns the oracle's raw `numericValue`, which carries **2** decimals
(`7796940` is `77969.40`). The price feed carries **18**. Both describe the same asset and
both come back as strings, so mixing them silently produces a fair value of 0 or 1.

The docs say to "format with the market's oracle price scale", but the scale is not on the
market row and `PRICE_DECIMALS()` reverts on the OracleHub adapter address returned by
`module.markets(...)`:

```
ContractFunctionExecutionError: The contract function "PRICE_DECIMALS" reverted.
  address: 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b
```

We ended up calibrating the scale from a fixed-strike test market, whose question text
embeds the human strike (`raw 7781525` vs `at or above 77815.25`). That works but should
not be the discovery path. Please put `oraclePriceDecimals` on the market row, or document
the constant next to `getOpeningPrices`.

## 4. `fetchPriceCandles` resolution is a string enum, not seconds

`getCandles(pool, 60)` takes seconds, so `fetchPriceCandles(asset, 60)` looks like it should
too. It fails with a schema error rather than a typed one:

```
indexer price-feed PriceCandles failed: A string is expected for type: candleresolution
```

The working call is `fetchPriceCandles(asset, "M1", { limit })`. Two adjacent candle APIs
with different resolution types is a papercut worth removing, or at least worth a line in
the reference.

## 5. Price-feed reads fail late, with a config error that names no default

Every price-feed method throws `needs config.priceFeed = { url }` if the exchange was built
without it. The URL is not in the SDK README, not in `SOMNIA_TESTNET_ADDRESSES`, and not in
the event-contracts docs page. We found
`https://price-feed.dev.oracle.somnia.host/v1/graphql` by grepping the compiled bundle.
Since the SDK bakes in per-chain contract addresses already, baking in the per-chain price
feed URL (or naming it in the error message) would close this.

## 6. `eth_getLogs` caps at 1000 blocks, and blocks are 100ms

A 1000-block range is 100 seconds of chain. Any "scan recent history" loop written with the
usual `fromBlock: head - 10_000n` fails with `block range exceeds 1000`. That is a
reasonable node limit, but on a 100ms chain it deserves a callout in the gotchas list next
to the indexer-lag note, because it silently changes how every history read must be written.

## 7. Settled markets leave nothing to learn from

Documented, and true, but stronger than expected in practice: every finalized market we
inspected on Shannon reports `settlement.backing == 0` because the venue's bots redeem
promptly. That is healthy, but it means an integrator cannot simulate a redeem against real
state before deploying anything. A long-lived market with a deliberately unredeemed position
(or a documented fixture address) would let contract authors test the redemption path
without spending testnet gas first.

## 8. Reactivity's 32 STT floor is invisible until you deploy

`SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE = 32 ether` applies to the subscribing
**contract**, and the reactivity docs mention it, but the hackathon path collides with it:
the public Shannon faucets dispense 0.001 STT and the alternatives need social login. A
hackathon whose headline chain feature is on-chain reactivity should ship a documented way
for a submission to reach 32 STT, or the feature is effectively unavailable to the people
being asked to showcase it. We designed around it by making settlement permissionless and
the reactor additive, which is better architecture anyway, but that was luck rather than
guidance.

## 9. Things that were notably good

- `binaryModuleWriteAbi` / `binarySettlementAbi` being exported verbatim meant our Solidity
  interfaces could mirror the SDK's own signatures with no hand-copying. This is the single
  best decision in the SDK for contract integrators.
- `mintSet(yesTo, noTo, amount)` on the pool delivering each leg to a different address is
  exactly the primitive a head-to-head product needs. It let CROSS exist as one call.
- The gotchas page predicted three bugs before we wrote them: expiry headroom, keying state
  by `marketId` rather than pool address, and `loadMarkets()` hiding finalized binaries.
- Deployless `eth_call` against a constructor worked perfectly against Somnia's RPC, which
  let us verify the entire fill path with zero gas. Worth advertising as a testing pattern.
  It is also how we now regression-test the struct decode in finding 2: a three-line harness
  reads a real finalized record through the production interface and compares it against
  viem, which would have caught that bug before it reached a deployment.

## `listLiveBinaryMarkets` decides what is "live" using the machine clock

`LiveBinaryMarketsFilter.nowSec` defaults to `Date.now()`. Every liveness cut in the SDK
(`listLiveBinaryMarkets`, `listPastBinaryMarkets`) is therefore made against the caller's
clock rather than `block.timestamp`.

Our dev machine was 8050 seconds behind the chain. The result was not an error, it was worse:
the call returned forty markets that had expired more than two hours earlier, ordered
closing-soonest, so every genuinely tradable market was pushed off the page. A bot filtering
that page for `status === "Trading"` finds nothing and concludes the venue is down. We spent
real time believing exactly that.

The docs already warn about this for `voidExpired`, where the SDK compares against the chain's
clock precisely because "a machine whose clock runs ahead would sail past this check". The same
reasoning applies to liveness, but there the default goes the other way.

Suggestions, in order of preference:

1. Default `nowSec` to the chain head the client already tracks, not `Date.now()`.
2. Failing that, return the node's `now` alongside the rows so a caller can detect drift.
3. At minimum, say in the `nowSec` doc comment that leaving it unset trusts the local clock,
   and that a drifting clock silently yields dead markets rather than an error.

A related sharp edge: a venue that lists many high frequency markets alongside a few slow ones
makes `listPastBinaryMarkets({ limit: 20 })` useless for finding a slow market, because the
page fills with 1m rows. Server-side filtering on cadence or resolution mode would help.
