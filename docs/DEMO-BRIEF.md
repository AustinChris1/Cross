# CROSS demo video: production brief

This is a complete brief for whoever records the demo. You do not need to know how the app was
built. Follow this document top to bottom. Every step says exactly what to click and what to say.

**Final video target:** 3 minutes, 1920 x 1080, MP4 with burned-in captions.

The hackathon asks for 2 to 3 minutes. Aim for 2:50 to 3:00. Going over reads as padding.

If anything is unclear, stop and ask before recording a bad take. Re-shoots cost more time than
questions do.

---

## 1. What CROSS is, in two sentences

dreamDEX runs a market every fifteen minutes asking one question: will BTC close above where
this window opened? CROSS lets you bet a specific person on that question by sending them a
link, and it settles itself on chain with no order book and no house.

The thing that makes it special: two people who disagree can be matched with **no seller at
all**. Their two stakes are minted directly into an UP token and a DOWN token. Nobody needs to
be quoting a price, which is why this works on a venue that is only weeks old.

You will demonstrate the full happy path: seeing live windows, posting a challenge, sending the
link, someone taking it, and the vault doing the same thing automatically.

---

## 2. What you need before recording

Have all of this ready before you press Record. If any one is missing, stop and ask.

### Machine and browser

- [ ] **A laptop or desktop.** Screen at 1920 x 1080. If your screen is larger, set browser zoom
      to 110% so the interface reads clearly in the final video.
- [ ] **Google Chrome** with **MetaMask** installed.
- [ ] **A second Chrome profile** (click your avatar, top-right, then "Add"). You need two
      separate wallets on camera: one posts the challenge, the other takes it. A second profile
      is much easier than logging in and out.
- [ ] **A terminal window** you can place beside the browser. You will show the vault's own
      reasoning in it, and that is the most persuasive twenty seconds of the video.

### Wallets

Both Chrome profiles need a MetaMask wallet on **Somnia Shannon**. The app adds the network for
you the first time you connect, so you do not need to add it by hand.

- [ ] **Wallet A** (main profile) needs a small amount of **STT** for gas. Ask the treasurer for
      it, or use a faucet: https://faucet.trade/somnia-shannon-stt-faucet
- [ ] **Wallet B** (second profile) needs STT too. It only sends one transaction, so a very small
      amount is enough.
- [ ] Neither wallet needs tUSDC beforehand. The app has a faucet button, and you will film
      pressing it.

### Software for recording

- [ ] **OBS Studio** (free, https://obsproject.com). Canvas 1920 x 1080, 30 fps.
- [ ] **An editing app.** CapCut Desktop (free) is fine. DaVinci Resolve if you know it.
- [ ] **A clean microphone**, or a quiet room. Hiss or echo makes the whole video unusable.

### What the treasurer provides

- [ ] **The site URL** (the Vercel address once it is deployed).
- [ ] **The `.env` file** for the machine running the solver. It contains a private key. Send it
      over a direct message, never plain email, and delete it after the shoot.
- [ ] **Confirmation that the venue has open windows.** Windows come and go. Check before you
      start, see section 3.

---

## 3. Before pressing record

Do this checklist every time you start a session.

1. **Confirm the venue is open.** In the terminal, in the project folder, run:

   ```sh
   node scripts/dev/post-open.mjs --dry 2>/dev/null || pnpm gates
   ```

   If you see `PASS` lines, there are live windows and you are good. If you see "no window with
   enough time", the venue is between windows. Wait a few minutes and try again. **Do not record
   during this state**, the app will correctly say it has no open windows and the demo will not
   make sense.

2. **Start the solver and leave it running.** In its own terminal window:

   ```sh
   DRY_RUN=false node solver/index.mjs
   ```

   Wait for the header to print. It must say `reactive somnia_watch (same block)` and
   `mode LIVE`. If it says `DRY RUN`, stop, you have the wrong command and the vault will not
   actually take anything on camera.

   **Leave this running for the entire shoot.** Without it, the vault never answers a challenge
   and scene 6 will not happen.

3. **Close every other browser tab.** No bookmarks bar, no extensions except MetaMask, no email.
4. **Browser zoom 110%.** Chrome menu, then Zoom.
5. **Mute all notifications.** Windows Focus Assist, or Mac Do Not Disturb.
6. **Record a 30 second test clip.** Talk while clicking. Listen back. Any hum or echo, fix it
   before continuing.
7. **Position the windows.** Browser filling the screen, terminal in a window you can bring
   forward for scene 6. Do not shrink the terminal so small the text is unreadable.

---

## 4. The script

Eight scenes. Each has three parts:

- **Show:** what is on screen
- **Do:** what you click
- **Say:** the exact words to read

Read slowly. Almost everyone speaks too fast on the first take. Slow to about 80% of what feels
natural.

If you fumble, pause for one second and start that sentence again. It gets cut in the edit.

---

### Scene 1: The hook (0:00 to 0:22)

**Show:** The CROSS landing page, at the top. Do not scroll yet. The headline reads
"Two buyers. No seller. One window." with live numbers underneath.

**Do:** Nothing for the first few seconds. Let the aurora animation breathe. Then move the mouse
slowly over the "Start a match" button so it leans toward the cursor, but **do not click**.

**Say:**

> Everyone has said it. Bet you it dumps this hour. And then nothing happens, because there is
> no way to settle it. CROSS is that bet, made real. You pick a side, you send a link, and
> fifteen minutes later the winner has been paid on chain. No bookmaker, no escrow agent, and
> nobody holding your money.

---

### Scene 2: The mechanic (0:22 to 0:48)

**Show:** Scroll slowly down to the section headed "One stake in. Two opposite halves out."
The diagram animates as it enters: two stakes fly in from the left into a `mintSet()` circle,
and an UP token and a DOWN token fly out to the right.

**Do:** Scroll at a steady, slow pace. Let the animation finish before you scroll past. Sit on
the completed diagram for three full seconds.

**Say:**

> Here is the part that is genuinely new. On an exchange, your bet needs someone already
> offering the other side, and on a young venue there usually is not one. dreamDEX has a
> different path. If two people want opposite sides, the pool takes their two stakes and mints
> one UP token and one DOWN token out of them. No seller. No order book touched. Nothing to
> slip. That single mechanic is what makes a social betting product possible here on day one.

---

### Scene 3: Into the app (0:48 to 1:05)

**Show:** Still on the landing page.

**Do:**

1. **Click "Start a match".** The app loads, showing a live window with a countdown.
2. **Click "Connect"** top-right. MetaMask opens. Approve the connection, and approve the
   network switch if it asks.
3. Once connected, **point the cursor at the countdown** for a moment.

**Say:**

> This is live on Somnia's Shannon testnet against real dreamDEX markets. The clock is the
> actual window. The line to beat is the opening price, exactly as the oracle will settle it.

---

### Scene 4: Getting funded (1:05 to 1:22)

**Show:** The match card. Under the numbers is a row of four steps: connect, fund, approve,
post. "Connect" is already green.

**Do:**

1. **Point at the four-step row.** Sit for two seconds.
2. **Click "Get 1000 test tUSDC".** Approve in MetaMask. Wait for the balance in the top-right
   to update.
3. **Click "Approve tUSDC".** Approve in MetaMask again.

**Say:**

> Every action walks you through connect, fund, approve, then act, and only unlocks the step you
> are actually on. That is deliberate. The first version put the final button first, and anyone
> with an empty wallet hit a raw contract revert with no idea why. Test tokens come from a
> faucet, one approval, and now I can post.

---

### Scene 5: Posting and sharing (1:22 to 1:50)

**This scene and the next are the heart of the video. Do not rush them.**

**Show:** The match card with UP and DOWN buttons and a payout field.

**Do:**

1. **Click "UP".** The button turns green.
2. **Set the payout to 20.** Point at the two boxes below: "You risk" and "You win". Say the
   numbers out loud as they are.
3. **Click the "Post UP" button.** Approve in MetaMask.
4. The page moves by itself to a challenge screen headed **"Your challenge"**.
5. **Click "Copy link".** It changes to "Copied".

**Say:**

> I pick UP, I set the payout to twenty, and the app tells me exactly what I risk and exactly
> what I win. One input, two honest numbers, no hidden spread. I post it, and CROSS hands me a
> link. That link is the whole product. It is what you paste into the group chat where the
> argument started.

---

### Scene 6: Someone takes it (1:50 to 2:20)

**Show:** Switch to the **second Chrome profile**. Paste the copied link into its address bar.

**Do:**

1. **Paste the link and press Enter.** The screen reads **"You have been challenged"**, showing
   the other wallet's address, your side, what you pay and what you win.
2. **Sit on this screen for three full seconds.** This is the frame that sells the product.
3. **Click "Connect"**, approve in MetaMask.
4. **Click through fund and approve** if this wallet needs them.
5. **Click "Take DOWN".** Approve in MetaMask.
6. The match now shows as **filled**.

**Say:**

> This is what the other person sees. Not a trading terminal. A challenge, with their side,
> their cost and their payout stated plainly. They connect, they take it, and the moment they
> do, both stakes are minted into the two tokens and held by the contract. Neither of us can
> back out and neither of us is holding the other's money.

---

### Scene 7: The vault takes the other side by itself (2:20 to 2:45)

**This is the strongest technical moment in the video. Give it room.**

**Show:** Bring the **terminal running the solver** to the front, large enough to read.

**Do:**

1. In the first Chrome profile, **post a second challenge**, this time leaving the opponent
   field blank so it goes to the open board. Any side, payout 20.
2. **Immediately switch to the terminal** and watch. Within a few seconds the solver prints its
   reasoning and fills the challenge.
3. **Hold on the terminal output for five full seconds** so viewers can read it. In the edit,
   zoom gently into the two lines starting `fair` and `fade`.

**Say:**

> Someone still has to take the other side. So anyone can deposit into a vault that does it
> automatically, and here it is thinking out loud. It reads the window as what it actually is, a
> digital option, not a coin flip. It works out that this side is worth eighty-two cents, sees
> it being offered at thirty, and takes it because that beats its required edge. If the price
> had been worse than fair value it would have refused. That is the difference between taking
> flow and being picked off by it.

**Note for the operator:** if the vault declines, that is not a bug, the price was inside its
edge. Post again at a more generous price, or say on camera that it refused and why. A refusal
is also a good demo, but only if you explain it.

---

### Scene 8: Settlement, track record, and close (2:45 to 3:00)

**Show:** Back in the first Chrome profile, scroll to the **Fade Vault** panel on the right.

**Do:**

1. **Point at the "Track record" block.** It reads about `1.0100 per share, from 1.0000` with a
   row of green and red bars.
2. **Point at one green bar and one red bar.**
3. **Scroll down to the Matches list** and point at a row marked **settled**.
4. Cut to the end card.

**Say:**

> When the window closes, the oracle calls it, anyone can trigger settlement, and the winner is
> paid the full amount. Nothing to claim. And the vault publishes its own record: one win, one
> loss, a share worth one point zero one. It can lose, and it shows you when it does. That is
> the honest version of being the house.
>
> CROSS. Two buyers, no seller, one window.

---

## 5. Editing checklist

### Audio

- [ ] **Cut every silence longer than half a second.**
- [ ] **Ambient music at -25 dB.** Instrumental, no vocals. Pixabay's free section, filter
      "ambient" or "minimal". Do not let it run over the end card.
- [ ] **Normalise voice to -3 dB peak.** Light noise reduction only. Do not use AI voice
      "enhancement", it sounds artificial.

### Captions

- [ ] **Auto-generate, then proofread every line.** Watch these specifically: **CROSS**,
      **dreamDEX**, **Somnia**, **Shannon**, **mintSet**, **tUSDC**, **oracle**, **UP**,
      **DOWN**, **fade**, **vault**.
- [ ] **32 pt bold sans-serif, white, black drop shadow, bottom centre.** Burn them in.

### Visuals

- [ ] **Hard cuts only.** No swipes or fades except the final one.
- [ ] **Three gentle zooms, no more:** the mint diagram in scene 2, the "You have been
      challenged" panel in scene 6, the solver's `fair` and `fade` lines in scene 7. 1.1x is
      plenty.
- [ ] **Speed up every wallet confirmation to 3x.** Nobody needs to watch MetaMask spin. This is
      the single biggest saving in the whole edit.
- [ ] **No colour grading.** The app is already designed.

### Open and close

- [ ] Open on the landing hero, no title card. The headline is the title card.
- [ ] End card: the CROSS mark on the dark background with "Two buyers. No seller. One window."
      Hold five seconds, silent, then fade.

---

## 6. Delivery

- **Format:** MP4, H.264
- **Resolution:** 1920 x 1080
- **Frame rate:** 30 fps
- **Audio:** AAC, 192 kbps stereo
- **Size:** under 200 MB

Send a 30 second preview first so pacing and audio can be checked before the full upload.

---

## 7. If something looks wrong

Stop and send a screenshot if you see any of these. Do not try to fix them yourself.

- The app says **"The venue has no open windows"**. Not a bug. dreamDEX is between windows.
  Wait and restart the scene.
- **A transaction fails with "no STT for gas".** The wallet needs topping up.
- **The solver prints `skip fade`.** It declined on price. Post again at a more generous number.
- **The solver header says `DRY RUN`.** It was started without `DRY_RUN=false`. Restart it.
- **The countdown looks wrong by hours.** The machine clock has drifted. The app corrects for
  this, but if it looks wrong, say so and stop.
- **A red banner appears** anywhere in the app.

---

## 8. Things to say out loud, because judges reward honesty

Work these in if there is room, or put them in the submission text if there is not:

- It is **testnet and unaudited**.
- **Day one liquidity is the vault's own capital.** Do not claim organic depth. The honest
  framing is that the vault is what makes a fill possible before anyone else shows up.
- **Settlement is permissionless first.** Anyone can settle a resolved match, which is what
  guarantees winners get paid even if both sides walk away.

---

## Runtime check

| Scene | Ends at |
|---|---|
| 1 Hook | 0:22 |
| 2 Mechanic | 0:48 |
| 3 Into the app | 1:05 |
| 4 Getting funded | 1:22 |
| 5 Posting and sharing | 1:50 |
| 6 Someone takes it | 2:20 |
| 7 The vault decides | 2:45 |
| 8 Settlement and close | 3:00 |

If you land over 3:10, cut scene 4 down to the faucet click alone. It is the least important
thirty seconds. Never cut scenes 6 or 7.
