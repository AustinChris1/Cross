# Demo script (2 to 3 minutes)

The whole lifecycle fits inside one 5-minute window, so nothing here is a mock or a
time-lapse. Record with two browser profiles side by side (maker and taker) plus a terminal
running the solver.

## Before recording

```sh
npm install && npm run build
npm run simulate            # have this output on screen already, it is the proof slide
npm run deploy              # needs STT in the deployer
cd web && npm run dev
DRY_RUN=false node solver/index.mjs
```

Fund both browser wallets with `Get 1000 test tUSDC` in the app, and deposit ~500 into the
vault so the fade has room.

## 0:00 to 0:20 - the problem

> "People bet each other on price moves in group chats every day. There is no way to settle
> it, and nobody wants to be the bookie. That is the whole product."

Show a chat message: "bet you BTC dumps this hour".

## 0:20 to 0:50 - the primitive

Show the dreamDEX docs line on screen:

> "Two opposite-side buyers can cross with no seller at all - the pool mints a fresh Up/Down
> pair from their combined collateral."

> "Every other venue needs a house or a book. Here, two people are enough. That is the fill
> path CROSS is built on, and it is why a brand new order book with no depth cannot stop a
> match from filling."

## 0:50 to 1:30 - post and fill

In the app, pick the soonest BTC 5m or 15m window.

- Point at the race panel: opening print, live spot, the clock.
- Point at the risk box: **one input, two numbers.** "I risk 11.60 to win 8.40." Say out loud
  that the payout is exact because there is no order book to slip against.
- Post UP. Copy the challenge link.
- In the second browser, open the link and take DOWN. Show both wallets signing.
- Show the match row flip to **filled**, and the explorer tx: one `mintSet` call, both legs
  now escrowed by Cross.

## 1:30 to 2:10 - the other side

Cut to the terminal:

```
#7 BTC 15m maker UP@0.580 -> vault DOWN@0.420
    BTC spot 77759.99 vs open 77969.40 (-0.269%), 370s left, vol 28% -> fair UP 0.3%
    fair DOWN 0.997  limit 0.967  edge 57.7pts  TAKE
```

> "The vault prices the window as what it actually is: a digital option. This one is already
> a quarter percent below its open with six minutes left, so UP is not a coin flip, it is
> under one percent. Anyone can deposit and be that side. That is the half of a prediction
> market nobody has ever been able to buy."

Show the vault panel: pool, live risk, utilisation moving.

## 2:10 to 2:40 - settlement

Let the clock hit zero on camera.

- The oracle resolves the window.
- The solver settles, or click **Settle** in the UI to show it is permissionless.
- Winner's balance moves. Match row flips to **settled**.
- Vault live risk drops back in the same transaction, because Cross calls back into the vault
  the moment it pays out.

> "No keeper, no claim button, no trust. Anyone can settle any match, and on Somnia the
> reactor can do it in the same block the market finalizes."

## 2:40 to 3:00 - why it matters to the venue

> "Every match mints new open interest instead of eating a young book's depth. Every deposit
> becomes standing capital ready to fill the next one. CROSS does not need dreamDEX to be
> liquid yet - it makes it liquid."

End on the mark and the line: **Two buyers. No seller. One window.**

## The shot that sells it

Run the solver live in a second terminal before recording:

```sh
node scripts/dev/post-open.mjs      # posts an open challenge
DRY_RUN=false node solver/index.mjs # the vault finds and takes it
```

The solver prints its reasoning, and that is the demo. It reads the window as a digital
option, not a coin flip:

```
#3 ETH 24h maker UP@0.700 -> vault DOWN@0.300
    ETH spot 2385.98 vs open 2418.08 (-1.328%), 41383s left, vol 41% -> fair UP 18.4%
    fair DOWN 0.816  limit 0.786  edge 51.6pts  TAKE
  fade #3 for 6.00 -> success
```

Say out loud what it just did: the maker offered DOWN at 0.30 when the window was already
1.3% below its opening print, so DOWN was worth 0.82. The vault took the other side because
the price beat fair value by more than its required edge, and it would have refused if it
had not. That is the whole argument for the vault in one screen.

Keep it running during the demo so anything a viewer posts gets filled within a tick.

## Sharing a challenge on camera

Post from the app and it routes you straight to `#/m/<id>`. Copy the link, open it in a
second browser profile, and the other side sees the challenge screen with their side, their
cost and their payout. That round trip is the growth loop, so show it rather than describe it.

## Things to say out loud, because judges reward honesty

- Testnet, unaudited.
- Day-one liquidity is the vault's own capital. Say it plainly; do not claim "always fills".
- The reactivity fast path needs 32 STT held by the subscribing contract, which the public
  faucets do not give out, so settlement is permissionless first and reactive second.

## Recording the landing page

The app has two routes. `/` is the landing page and `#/app` is the product. Open on `/` for
the first twenty seconds of the video: the hero states the whole thesis in one line, the
comparison table makes the "who takes the other side" point without narration, and the mint
diagram shows the mechanic in a single frame. Then hit **Start a match** on camera so the
cut to the app is a real click rather than an edit.
