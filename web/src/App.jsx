import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, maxUint256 } from "viem";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Copy,
  Swords,
  ArrowLeft,
  Check,
  CheckCircle2,
  Coins,
  Droplets,
  Gavel,
  Loader2,
  PenLine,
  ShieldCheck,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Wordmark } from "./Logo.jsx";
import { CFG, publicClient, walletClient, connect, erc20Abi, liveWindows, openingPrices, spotPrices } from "./chain.js";
import { fairUpProbability, pct, usd, countdown, racePosition } from "./pricing.js";
import crossArtifact from "../../out/Cross.json";
import vaultArtifact from "../../out/FadeVault.json";

const CROSS_ABI = crossArtifact.abi;
const VAULT_ABI = vaultArtifact.abi;
const DEC = 6;
const ZERO = "0x0000000000000000000000000000000000000000";
const unit = (n) => parseUnits(String(n || 0), DEC);
const human = (v) => Number(formatUnits(v ?? 0n, DEC));
const STATE = ["none", "open", "filled", "settled", "cancelled"];
const ease = [0.22, 1, 0.36, 1];

export default function App({ go, focusId = null }) {
  const [account, setAccount] = useState(null);
  const [windows, setWindows] = useState([]);
  const [opens, setOpens] = useState({});
  const [spots, setSpots] = useState({});
  const [selected, setSelected] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [matches, setMatches] = useState([]);
  const [vault, setVault] = useState(null);
  const [wallet, setWallet] = useState({ balance: 0n, allowCross: 0n, allowVault: 0n });
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);

  const configured = Boolean(CFG.cross && CFG.vault);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshMarkets = useCallback(async () => {
    try {
      const w = await liveWindows();
      setWindows(w);
      setSelected((s) => s ?? w[0]?.marketId ?? null);
      const [o, s] = await Promise.all([
        openingPrices(w.map((m) => m.marketId)),
        spotPrices([...new Set(w.map((m) => m.asset))]),
      ]);
      setOpens(o);
      setSpots(s);
    } catch (e) {
      setToast({ kind: "err", text: `Market data: ${e.message}` });
    }
  }, []);

  const refreshChain = useCallback(async () => {
    if (!configured) return;
    try {
      const count = Number(
        await publicClient.readContract({ address: CFG.cross, abi: CROSS_ABI, functionName: "matchCount" }),
      );
      const ids = [];
      for (let i = count; i > Math.max(0, count - 25); i--) ids.push(i);
      const rows = await Promise.all(
        ids.map(async (id) => ({
          id,
          ...(await publicClient.readContract({
            address: CFG.cross,
            abi: CROSS_ABI,
            functionName: "getMatch",
            args: [BigInt(id)],
          })),
        })),
      );
      setMatches(rows);

      const [assets, committed, shares] = await Promise.all([
        publicClient.readContract({ address: CFG.vault, abi: VAULT_ABI, functionName: "totalAssets" }),
        publicClient.readContract({ address: CFG.vault, abi: VAULT_ABI, functionName: "committed" }),
        publicClient.readContract({ address: CFG.vault, abi: VAULT_ABI, functionName: "totalShares" }),
      ]);
      let mine = 0n;
      if (account) {
        const [m, bal, aC, aV] = await Promise.all([
          publicClient.readContract({ address: CFG.vault, abi: VAULT_ABI, functionName: "sharesOf", args: [account] }),
          publicClient.readContract({ address: CFG.collateral, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          publicClient.readContract({ address: CFG.collateral, abi: erc20Abi, functionName: "allowance", args: [account, CFG.cross] }),
          publicClient.readContract({ address: CFG.collateral, abi: erc20Abi, functionName: "allowance", args: [account, CFG.vault] }),
        ]);
        mine = m;
        setWallet({ balance: bal, allowCross: aC, allowVault: aV });
      }
      setVault({ assets, committed, shares, mine });
    } catch (e) {
      setToast({ kind: "err", text: `Chain read: ${e.message.slice(0, 140)}` });
    }
  }, [account, configured]);

  useEffect(() => {
    refreshMarkets();
    const t = setInterval(refreshMarkets, 20000);
    return () => clearInterval(t);
  }, [refreshMarkets]);

  useEffect(() => {
    refreshChain();
    const t = setInterval(refreshChain, 8000);
    return () => clearInterval(t);
  }, [refreshChain]);

  const priced = useMemo(
    () =>
      windows.map((w) => {
        const opening = opens[w.marketId.toLowerCase()] ?? null;
        const spot = spots[w.asset] ?? null;
        const secondsLeft = w.expiry - now;
        const fairUp = opening && spot ? fairUpProbability({ spot, opening, secondsLeft, vol: 0.3 }) : null;
        return { ...w, opening, spot, secondsLeft, fairUp };
      }),
    [windows, opens, spots, now],
  );

  const active = priced.find((w) => w.marketId === selected) ?? priced[0];
  const focused = focusId ? (matches.find((m) => m.id === focusId) ?? null) : null;
  const onConnect = () => connect().then(setAccount).catch((e) => setToast({ kind: "err", text: e.message }));

  const send = useCallback(
    async (address, abi, functionName, args, label, okMessage) => {
      setBusy(label);
      try {
        const wc = walletClient();
        const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
        const hash = await wc.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        await refreshChain();
        if (okMessage) setToast({ kind: "ok", text: okMessage });
        // Land the maker on their own shareable challenge, which is the whole point of posting.
        if (functionName === "postChallenge") {
          const id = await publicClient.readContract({
            address: CFG.cross,
            abi: CROSS_ABI,
            functionName: "matchCount",
          });
          window.location.hash = `#/m/${id}`;
        }
      } catch (e) {
        setToast({ kind: "err", text: explain(e, label) });
      } finally {
        setBusy("");
      }
    },
    [account, refreshChain],
  );

  return (
    <div className="min-h-screen">
      <nav className="glass sticky top-0 z-50 flex items-center justify-between border-b border-line px-6 py-3.5">
        <button onClick={go} className="flex items-center gap-3 text-muted transition hover:text-ink">
          <ArrowLeft className="size-4" />
          <Wordmark size={26} />
        </button>
        <div className="flex items-center gap-4 text-sm">
          {account && (
            <span className="mono hidden items-center gap-1.5 text-ink-2 sm:inline-flex">
              <Coins className="size-3.5" />
              {usd(human(wallet.balance))}
            </span>
          )}
          {account ? (
            <span className="mono inline-flex items-center gap-2 rounded-lg hairline px-3 py-1.5 text-xs text-ink-2">
              <span className="size-1.5 rounded-full bg-up" />
              {account.slice(0, 6)}…{account.slice(-4)}
            </span>
          ) : (
            <button
              onClick={onConnect}
              className="inline-flex items-center gap-2 rounded-lg bg-up px-4 py-2 text-sm font-semibold text-[#05231a] transition hover:brightness-110"
            >
              <Wallet className="size-4" />
              Connect
            </button>
          )}
        </div>
      </nav>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed left-1/2 top-20 z-50 w-[min(560px,92vw)] -translate-x-1/2"
          >
            <div
              className={`flex items-start gap-3 rounded-xl border bg-surface/95 px-4 py-3 text-sm backdrop-blur ${
                toast.kind === "ok" ? "border-up/40 text-ink" : "border-down/50 text-ink"
              }`}
            >
              {toast.kind === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-down" />
              )}
              <span>{toast.text}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
        {!configured && (
          <div className="mb-5 rounded-xl border border-down/40 bg-surface px-4 py-3 text-sm text-ink-2">
            No contract addresses configured. Run the deploy script, then set VITE_CROSS_ADDRESS and VITE_VAULT_ADDRESS.
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          <div className="space-y-5">
            {focused && (
              <ChallengeBanner
                m={focused}
                account={account}
                wallet={wallet}
                send={send}
                busy={busy}
                onConnect={onConnect}
                now={now}
                onDismiss={() => {
                  window.location.hash = "#/app";
                }}
              />
            )}
            <MatchCard w={active} account={account} wallet={wallet} send={send} busy={busy} onConnect={onConnect} />
            <WindowList priced={priced} selected={active?.marketId} onSelect={setSelected} />
            <MatchTable matches={matches} account={account} send={send} busy={busy} />
          </div>
          <VaultCard vault={vault} account={account} wallet={wallet} send={send} busy={busy} onConnect={onConnect} />
        </div>
      </div>
    </div>
  );
}

/** Turns a raw revert into something a person can act on. */
function explain(e, label) {
  const raw = (e.shortMessage ?? e.message ?? "").toString();
  if (/insufficient funds/i.test(raw)) return "No STT for gas. Fund your wallet from a Somnia faucet.";
  if (/User rejected|denied/i.test(raw)) return "You rejected the transaction.";
  if (/deposit/i.test(label) || /transferFrom|TransferFailed/i.test(raw))
    return `${label} failed. Check you hold enough tUSDC and have approved it.`;
  return `${label}: ${raw.slice(0, 160)}`;
}

function Card({ children, className = "" }) {
  return <div className={`rounded-2xl hairline bg-surface p-5 ${className}`}>{children}</div>;
}

function CardTitle({ icon: Icon, children, right }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
        <Icon className="size-3.5" />
        {children}
      </div>
      {right}
    </div>
  );
}

function MatchCard({ w, account, wallet, send, busy, onConnect }) {
  const [side, setSide] = useState("UP");
  const [payout, setPayout] = useState(20);
  const [opponent, setOpponent] = useState("");

  if (!w)
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading live windows
        </div>
      </Card>
    );

  const fair = w.fairUp;
  const rawPrice = side === "UP" ? fair ?? 0.5 : 1 - (fair ?? 0.5);
  const price = Math.min(0.95, Math.max(0.05, rawPrice));
  const risk = payout * price;
  const win = payout - risk;
  const moved = w.opening && w.spot ? (w.spot / w.opening - 1) * 100 : null;
  const racePos = racePosition({ spot: w.spot, opening: w.opening, intervalSec: w.intervalSec });
  const needed = unit(risk.toFixed(6));
  const tooLate = w.secondsLeft <= 360;
  const rising = w.spot >= w.opening;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="display text-2xl font-bold">{w.asset}</span>
          <span className="mono rounded-full bg-raised px-2 py-0.5 text-[10px] text-ink-2">{w.interval}</span>
        </div>
        <div className="text-right">
          <div className="mono text-2xl font-medium tabular-nums">{countdown(w.secondsLeft)}</div>
          <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-muted">
            <Timer className="size-3" /> to settle
          </div>
        </div>
      </div>

      {/* the race: spot against the opening print */}
      <div className="relative mt-4 h-32 overflow-hidden rounded-xl hairline bg-gradient-to-b from-up/10 via-transparent to-down/10">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/15" />
        <div className="mono absolute left-3 top-1/2 -translate-y-1/2 rounded bg-surface px-2 py-0.5 text-[11px] text-muted">
          open {w.opening ? usd(w.opening) : "…"}
        </div>
        {w.spot && w.opening && (
          <>
            <motion.div
              animate={{ top: `${racePos}%` }}
              transition={{ duration: 0.6, ease }}
              className={`absolute inset-x-0 border-t-2 ${rising ? "border-up" : "border-down"}`}
            />
            <motion.div
              animate={{ top: `${racePos}%` }}
              transition={{ duration: 0.6, ease }}
              className={`mono absolute right-3 -translate-y-1/2 rounded bg-surface px-2 py-1 text-xs font-medium ${
                rising ? "text-up" : "text-down"
              }`}
            >
              {usd(w.spot)} {moved != null && `${moved >= 0 ? "+" : ""}${moved.toFixed(3)}%`}
            </motion.div>
          </>
        )}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-down/70">
        <motion.div
          animate={{ width: `${(fair ?? 0.5) * 100}%` }}
          transition={{ duration: 0.6, ease }}
          className="h-full bg-up"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-1.5">
          <TrendingUp className="size-3.5 text-up" />
          <b className="text-up">{fair == null ? "…" : pct(fair)}</b>
        </span>
        <span className="mono text-[11px] text-muted">vs the opening print</span>
        <span className="inline-flex items-center gap-1.5">
          <b className="text-down">{fair == null ? "…" : pct(1 - fair)}</b>
          <TrendingDown className="size-3.5 text-down" />
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {["UP", "DOWN"].map((s) => {
          const on = side === s;
          const isUp = s === "UP";
          return (
            <motion.button
              key={s}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSide(s)}
              className={`display flex items-center justify-center gap-2 rounded-xl border py-3.5 font-bold tracking-wider transition ${
                on
                  ? isUp
                    ? "border-up bg-up/12 text-up"
                    : "border-down bg-down/12 text-down"
                  : "border-line bg-ground text-ink-2 hover:border-white/20"
              }`}
            >
              {isUp ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              {s}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Payout to winner">
          <input
            type="number"
            min="1"
            value={payout}
            onChange={(e) => setPayout(Number(e.target.value))}
            className="w-full rounded-xl border border-line bg-ground px-3 py-2.5 outline-none focus:border-white/25"
          />
        </Field>
        <Field label="Challenge someone (optional)">
          <input
            placeholder="0x… or leave blank"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value.trim())}
            className="w-full rounded-xl border border-line bg-ground px-3 py-2.5 text-sm outline-none focus:border-white/25"
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="You risk" value={usd(risk)} tone="down" />
        <Metric label="You win" value={`+${usd(win)}`} tone="up" />
      </div>

      <div className="mt-5">
        <ActionGate
          account={account}
          wallet={wallet}
          needed={needed}
          spender={CFG.cross}
          allowance={wallet.allowCross}
          send={send}
          busy={busy}
          onConnect={onConnect}
          finalLabel="post"
          action={
            <PrimaryButton
              tone={side === "UP" ? "up" : "down"}
              disabled={!!busy || tooLate || payout <= 0}
              busy={busy === "post challenge"}
              icon={PenLine}
              onClick={() =>
                send(
                  CFG.cross,
                  CROSS_ABI,
                  "postChallenge",
                  [w.marketId, side === "UP" ? 0 : 1, unit(payout), Math.round(price * 1e6), opponent || ZERO, 0],
                  "post challenge",
                  `Posted ${side} on ${w.asset} ${w.interval}.`,
                )
              }
            >
              {tooLate ? "Window closes too soon" : `Post ${side} at ${price.toFixed(2)}`}
            </PrimaryButton>
          }
        />
      </div>
    </Card>
  );
}

/** Copies a match link and confirms it inline, so sharing is one tap. */
function ShareButton({ matchId, className = "", label = "Copy link" }) {
  const [done, setDone] = useState(false);
  const url = `${window.location.origin}${window.location.pathname}#/m/${matchId}`;
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          window.prompt("Copy this link", url);
        }
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg hairline px-3 py-1.5 text-xs transition hover:border-white/25 ${className}`}
    >
      {done ? <Check className="size-3 text-up" /> : <Copy className="size-3" />}
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * What someone sees when they open a shared link. The whole point of the product is that
 * this screen is one tap from a message, so it states the terms and nothing else.
 */
function ChallengeBanner({ m, account, wallet, send, busy, onConnect, now, onDismiss }) {
  const yourSide = m.makerSide === 0 ? "DOWN" : "UP";
  const theirSide = m.makerSide === 0 ? "UP" : "DOWN";
  const payout = human(m.contracts);
  const makerStake = human(m.makerStake);
  const yourCost = payout - makerStake;
  const secondsLeft = Number(m.expiry) - now;
  const isMine = account && m.maker.toLowerCase() === account.toLowerCase();
  const forSomeoneElse =
    m.designated !== ZERO && account && m.designated.toLowerCase() !== account.toLowerCase();
  const open = m.state === 1;
  const needed = unit(yourCost.toFixed(6));

  return (
    <motion.div
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/10 to-surface p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-raised text-gold">
            <Swords className="size-5" />
          </div>
          <div>
            <div className="display text-lg font-bold">
              {isMine ? "Your challenge" : "You have been challenged"}
            </div>
            <div className="mono text-xs text-ink-2">
              {m.maker.slice(0, 6)}…{m.maker.slice(-4)} took{" "}
              <span className={m.makerSide === 0 ? "text-up" : "text-down"}>{theirSide}</span> for {usd(payout)}
            </div>
          </div>
        </div>
        <button onClick={onDismiss} className="text-xs text-muted transition hover:text-ink">
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <div className="rounded-xl hairline bg-surface-2 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted">Your side</div>
          <div className={`display mt-0.5 text-lg font-bold ${yourSide === "UP" ? "text-up" : "text-down"}`}>
            {yourSide}
          </div>
        </div>
        <div className="rounded-xl hairline bg-surface-2 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted">You pay</div>
          <div className="mono mt-0.5 text-lg font-medium text-down">{usd(yourCost)}</div>
        </div>
        <div className="rounded-xl hairline bg-surface-2 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted">You win</div>
          <div className="mono mt-0.5 text-lg font-medium text-up">+{usd(makerStake)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Timer className="size-3.5" />
          {secondsLeft > 0 ? `${countdown(secondsLeft)} until the window settles` : "window closed"}
        </span>
        <ShareButton matchId={m.id} />
      </div>

      <div className="mt-4">
        {!open ? (
          <div className="rounded-xl hairline bg-surface-2 px-4 py-3 text-sm text-ink-2">
            This challenge is {STATE[m.state]}. Nothing to take.
          </div>
        ) : isMine ? (
          <div className="rounded-xl hairline bg-surface-2 px-4 py-3 text-sm text-ink-2">
            Waiting for someone to take the other side. Send them the link.
          </div>
        ) : forSomeoneElse ? (
          <div className="rounded-xl hairline bg-surface-2 px-4 py-3 text-sm text-ink-2">
            This one is reserved for {m.designated.slice(0, 6)}…{m.designated.slice(-4)}.
          </div>
        ) : (
          <ActionGate
            account={account}
            wallet={wallet}
            needed={needed}
            spender={CFG.cross}
            allowance={wallet.allowCross}
            send={send}
            busy={busy}
            onConnect={onConnect}
            finalLabel="take"
            action={
              <PrimaryButton
                tone={yourSide === "UP" ? "up" : "down"}
                icon={Swords}
                busy={busy === `take ${m.id}`}
                disabled={!!busy || secondsLeft <= 0}
                onClick={() =>
                  send(
                    CFG.cross,
                    CROSS_ABI,
                    "acceptChallenge",
                    [BigInt(m.id)],
                    `take ${m.id}`,
                    "You are in the match. Both legs are escrowed.",
                  )
                }
              >
                Take {yourSide} for {usd(yourCost)}
              </PrimaryButton>
            }
          />
        )}
      </div>
    </motion.div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-xl hairline bg-surface-2 px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mono mt-0.5 text-2xl font-medium ${tone === "up" ? "text-up" : "text-down"}`}>{value}</div>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, busy, icon: Icon, tone = "up" }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "up" ? "bg-up text-[#05231a]" : "bg-down text-[#2b0710]"
      } hover:brightness-110`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : Icon && <Icon className="size-4" />}
      {children}
    </motion.button>
  );
}

/**
 * Walks connect, fund, approve, act in order and only enables the step you are on.
 * The previous build offered the final action first, so an empty wallet hit a raw revert.
 */
function ActionGate({ account, wallet, needed, spender, allowance, send, busy, onConnect, action, finalLabel = "act" }) {
  const funded = wallet.balance >= needed && wallet.balance > 0n;
  const approved = allowance >= needed && needed > 0n;
  const step = !account ? 0 : !funded ? 1 : !approved ? 2 : 3;
  const steps = [
    { icon: Wallet, label: "connect" },
    { icon: Droplets, label: "fund" },
    { icon: ShieldCheck, label: "approve" },
    { icon: Check, label: finalLabel },
  ];

  return (
    <>
      <div className="mb-3 flex gap-1.5">
        {steps.map((s, i) => {
          const done = step > i;
          const nowAt = step === i;
          return (
            <div
              key={s.label}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] transition ${
                done
                  ? "border-up/40 bg-up/10 text-up"
                  : nowAt
                    ? "border-gold/60 bg-gold/10 text-ink"
                    : "border-line bg-surface-2 text-muted"
              }`}
            >
              {done ? <Check className="size-3" /> : <s.icon className="size-3" />}
              <span className="mono">{s.label}</span>
            </div>
          );
        })}
      </div>

      {step === 0 && (
        <PrimaryButton onClick={onConnect} icon={Wallet}>
          Connect wallet
        </PrimaryButton>
      )}
      {step === 1 && (
        <PrimaryButton
          icon={Droplets}
          busy={busy === "get tUSDC"}
          disabled={!!busy}
          onClick={() => send(CFG.collateral, erc20Abi, "faucet", [unit(1000)], "get tUSDC", "1000 test tUSDC added.")}
        >
          Get 1000 test tUSDC
        </PrimaryButton>
      )}
      {step === 2 && (
        <PrimaryButton
          icon={ShieldCheck}
          busy={busy === "approve tUSDC"}
          disabled={!!busy}
          onClick={() =>
            send(CFG.collateral, erc20Abi, "approve", [spender, maxUint256], "approve tUSDC", "Approved once, done.")
          }
        >
          Approve tUSDC
        </PrimaryButton>
      )}
      {step === 3 && action}
    </>
  );
}

function WindowList({ priced, selected, onSelect }) {
  return (
    <Card>
      <CardTitle icon={Timer}>Live windows</CardTitle>
      {priced.length === 0 && <div className="text-sm text-muted">No open windows right now.</div>}
      <div className="space-y-2">
        {priced.map((w) => {
          const on = w.marketId === selected;
          const rising = w.spot >= w.opening;
          return (
            <motion.button
              key={w.marketId}
              whileHover={{ x: 3 }}
              onClick={() => onSelect(w.marketId)}
              className={`grid w-full grid-cols-[76px_1fr_auto] items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                on ? "border-up bg-up/8" : "border-line bg-surface-2 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="display text-sm font-bold">{w.asset}</span>
                <span className="mono rounded-full bg-raised px-1.5 text-[9.5px] text-ink-2">{w.interval}</span>
              </div>
              <div className="mono flex items-center gap-2 text-xs text-ink-2">
                {w.opening ? usd(w.opening) : "…"}
                {w.spot && w.opening && (
                  <span className={rising ? "text-up" : "text-down"}>
                    {rising ? <TrendingUp className="inline size-3" /> : <TrendingDown className="inline size-3" />}{" "}
                    {((w.spot / w.opening - 1) * 100).toFixed(3)}%
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="mono text-sm">{countdown(w.secondsLeft)}</div>
                <div className="text-[10px] text-muted">UP {w.fairUp == null ? "…" : pct(w.fairUp)}</div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </Card>
  );
}

function MatchTable({ matches, account, send, busy }) {
  const rows = matches.filter((m) => m.state !== 0);
  return (
    <Card>
      <CardTitle icon={Gavel}>Matches</CardTitle>
      {rows.length === 0 ? (
        <div className="text-sm text-muted">No matches yet. Post the first one.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 rounded-xl hairline bg-surface-2 px-3.5 py-3"
            >
              <span className="mono w-6 text-xs text-muted">#{m.id}</span>
              <span
                className={`display inline-flex items-center gap-1 text-sm font-bold ${
                  m.makerSide === 0 ? "text-up" : "text-down"
                }`}
              >
                {m.makerSide === 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {m.makerSide === 0 ? "UP" : "DOWN"}
              </span>
              <span className="mono text-sm">{usd(human(m.contracts))}</span>
              <span className="mono hidden text-xs text-muted sm:inline">
                {m.maker.slice(0, 6)}…{m.maker.slice(-4)}
              </span>
              <span
                className={`mono ml-auto rounded-full border px-2.5 py-0.5 text-[10px] ${
                  m.state === 3
                    ? "border-up/40 bg-up/10 text-up"
                    : m.state === 2
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-line text-muted"
                }`}
              >
                {STATE[m.state]}
              </span>
              {m.state === 1 && <ShareButton matchId={m.id} label="Link" />}
              {m.state === 1 && account && m.maker.toLowerCase() !== account.toLowerCase() && (
                <button
                  disabled={!!busy}
                  onClick={() => send(CFG.cross, CROSS_ABI, "acceptChallenge", [BigInt(m.id)], `take ${m.id}`, "You are in.")}
                  className="rounded-lg hairline px-3 py-1.5 text-xs transition hover:border-white/25"
                >
                  Take {m.makerSide === 0 ? "DOWN" : "UP"}
                </button>
              )}
              {m.state === 2 && (
                <button
                  disabled={!!busy}
                  onClick={() => send(CFG.cross, CROSS_ABI, "settle", [BigInt(m.id)], `settle ${m.id}`, "Settled and paid.")}
                  className="rounded-lg hairline px-3 py-1.5 text-xs transition hover:border-white/25"
                >
                  Settle
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </Card>
  );
}

function VaultCard({ vault, account, wallet, send, busy, onConnect }) {
  const [amount, setAmount] = useState(100);
  const assets = human(vault?.assets);
  const committed = human(vault?.committed);
  const util = assets > 0 ? committed / assets : 0;
  const myShare = vault && vault.shares > 0n ? Number(vault.mine) / Number(vault.shares) : 0;
  const needed = unit(amount);

  return (
    <Card className="lg:sticky lg:top-20">
      <CardTitle icon={Coins}>Fade Vault</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-ink-2">Deposit and take the side nobody else will.</p>

      <div className="grid grid-cols-3 gap-2">
        {[
          { k: "Pool", v: usd(assets) },
          { k: "At risk", v: usd(committed) },
          { k: "In use", v: `${Math.round(util * 100)}%` },
        ].map((s) => (
          <div key={s.k} className="rounded-xl hairline bg-surface-2 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted">{s.k}</div>
            <div className="mono mt-0.5 text-lg font-medium">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
        <motion.div animate={{ width: `${util * 100}%` }} transition={{ duration: 0.6, ease }} className="h-full bg-violet" />
      </div>

      {account && vault && vault.mine > 0n && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-up/30 bg-up/8 px-3.5 py-2.5 text-xs text-ink-2">
          <Users className="size-3.5 text-up" />
          You own {(myShare * 100).toFixed(2)}%, worth {usd(assets * myShare)}
        </div>
      )}

      <div className="mt-4">
        <Field label="Amount (tUSDC)">
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full rounded-xl border border-line bg-ground px-3 py-2.5 outline-none focus:border-white/25"
          />
        </Field>
      </div>

      <div className="mt-4">
        <ActionGate
          account={account}
          wallet={wallet}
          needed={needed}
          spender={CFG.vault}
          allowance={wallet.allowVault}
          send={send}
          busy={busy}
          onConnect={onConnect}
          finalLabel="deposit"
          action={
            <PrimaryButton
              icon={Coins}
              busy={busy === "deposit"}
              disabled={!!busy || amount <= 0}
              onClick={() => send(CFG.vault, VAULT_ABI, "deposit", [needed], "deposit", "You are the house now.")}
            >
              Deposit {usd(amount)}
            </PrimaryButton>
          }
        />
      </div>

      {account && vault?.mine > 0n && (
        <button
          disabled={!!busy}
          onClick={() => send(CFG.vault, VAULT_ABI, "withdraw", [vault.mine], "withdraw", "Withdrawn.")}
          className="mt-2.5 w-full rounded-xl hairline py-3 text-sm transition hover:border-white/25"
        >
          Withdraw everything
        </button>
      )}

      <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
        Underwriting profit and loss, not a yield product. It can lose. Only idle collateral is withdrawable.
      </p>
    </Card>
  );
}
