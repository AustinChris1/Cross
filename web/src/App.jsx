import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, maxUint256 } from "viem";
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

export default function App({ go }) {
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
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const configured = Boolean(CFG.cross && CFG.vault);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

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
      setError(`market data: ${e.message}`);
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
      setError(`chain read: ${e.message}`);
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

  const send = useCallback(
    async (address, abi, functionName, args, label, okMessage) => {
      setError("");
      setFlash("");
      setBusy(label);
      try {
        const wc = walletClient();
        const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
        const hash = await wc.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        await refreshChain();
        if (okMessage) setFlash(okMessage);
      } catch (e) {
        setError(explain(e, label));
      } finally {
        setBusy("");
      }
    },
    [account, refreshChain],
  );

  return (
    <>
      <nav className="nav">
        <button className="btn btn-ghost" style={{ border: "none", padding: 0 }} onClick={go}>
          <Wordmark size={26} />
        </button>
        <div className="nav-links">
          {account && <span className="mono dim">{usd(human(wallet.balance))} tUSDC</span>}
          {account ? (
            <span className="mono muted">
              {account.slice(0, 6)}…{account.slice(-4)}
            </span>
          ) : (
            <button className="btn btn-primary" onClick={() => connect().then(setAccount).catch((e) => setError(e.message))}>
              Connect wallet
            </button>
          )}
        </div>
      </nav>

      <div className="shell">
        {!configured && (
          <div className="notice err" style={{ marginTop: 20 }}>
            No contract addresses configured. Run <code>npm run deploy</code>, then put the two addresses in
            <code>web/.env.local</code>.
          </div>
        )}
        {error && (
          <div className="notice err" style={{ marginTop: 20 }}>
            {error}
          </div>
        )}
        {flash && (
          <div className="notice ok" style={{ marginTop: 20 }}>
            {flash}
          </div>
        )}

        <div className="app-grid">
          <div>
            <MatchCard w={active} account={account} wallet={wallet} send={send} busy={busy} onConnect={() => connect().then(setAccount).catch((e) => setError(e.message))} />
            <div style={{ height: 16 }} />
            <WindowList priced={priced} selected={active?.marketId} onSelect={setSelected} />
            <div style={{ height: 16 }} />
            <MatchTable matches={matches} account={account} send={send} busy={busy} />
          </div>
          <div>
            <VaultCard vault={vault} account={account} wallet={wallet} send={send} busy={busy} onConnect={() => connect().then(setAccount).catch((e) => setError(e.message))} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Turns a raw revert into something a person can act on. */
function explain(e, label) {
  const raw = (e.shortMessage ?? e.message ?? "").toString();
  if (/insufficient funds/i.test(raw)) return "Your wallet has no STT for gas. Fund it from a Somnia faucet first.";
  if (/User rejected|denied/i.test(raw)) return "You rejected the transaction in your wallet.";
  if (/deposit/i.test(label) || /transferFrom|TransferFailed/i.test(raw))
    return `${label} failed. Check you hold enough tUSDC and have approved it, using the buttons above.`;
  return `${label}: ${raw.slice(0, 180)}`;
}

/** The one input, two numbers rule: you set the payout, we show what you risk and what you win. */
function MatchCard({ w, account, wallet, send, busy, onConnect }) {
  const [side, setSide] = useState("UP");
  const [payout, setPayout] = useState(20);
  const [opponent, setOpponent] = useState("");

  if (!w) return <div className="card">Loading live windows…</div>;

  const fair = w.fairUp;
  const rawPrice = side === "UP" ? fair ?? 0.5 : 1 - (fair ?? 0.5);
  const price = Math.min(0.95, Math.max(0.05, rawPrice));
  const risk = payout * price;
  const win = payout - risk;
  const moved = w.opening && w.spot ? (w.spot / w.opening - 1) * 100 : null;
  const racePos = racePosition({ spot: w.spot, opening: w.opening, intervalSec: w.intervalSec });
  const needed = unit(risk.toFixed(6));

  const hasFunds = wallet.balance >= needed;
  const hasAllowance = wallet.allowCross >= needed;
  const tooLate = w.secondsLeft <= 360;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="card-title">The match</div>
          <div style={{ marginTop: 6 }}>
            <span className="asset" style={{ fontSize: 21 }}>
              {w.asset}
            </span>
            <span className="chip">{w.interval}</span>
            <span className="chip">{w.trades} trades</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="clock">{countdown(w.secondsLeft)}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            until settlement
          </div>
        </div>
      </div>

      <div className="race">
        <div className="open-line" />
        <div className="open-label mono">open {w.opening ? usd(w.opening) : "…"}</div>
        {w.spot && w.opening && (
          <>
            <div
              className="spot-line"
              style={{ top: `${racePos}%`, borderColor: w.spot >= w.opening ? "var(--up)" : "var(--down)" }}
            />
            <div
              className="spot-label"
              style={{ top: `${racePos}%`, color: w.spot >= w.opening ? "var(--up)" : "var(--down)" }}
            >
              {usd(w.spot)} {moved != null && `${moved >= 0 ? "+" : ""}${moved.toFixed(3)}%`}
            </div>
          </>
        )}
      </div>

      <div className="odds-bar">
        <span style={{ width: `${(fair ?? 0.5) * 100}%` }} />
      </div>
      <div className="odds-legend">
        <span>
          UP <b className="up">{fair == null ? "…" : pct(fair)}</b>
        </span>
        <span className="muted mono" style={{ fontSize: 12 }}>
          the line to beat is the opening print
        </span>
        <span>
          DOWN <b className="down">{fair == null ? "…" : pct(1 - fair)}</b>
        </span>
      </div>

      <label>Your side</label>
      <div className="side-toggle">
        <button className={side === "UP" ? "on-up" : ""} onClick={() => setSide("UP")}>
          UP
        </button>
        <button className={side === "DOWN" ? "on-down" : ""} onClick={() => setSide("DOWN")}>
          DOWN
        </button>
      </div>

      <label>Payout to the winner (tUSDC)</label>
      <input type="number" min="1" value={payout} onChange={(e) => setPayout(Number(e.target.value))} />

      <label>Challenge someone specific (optional)</label>
      <input placeholder="0x… or leave blank for the open board" value={opponent} onChange={(e) => setOpponent(e.target.value.trim())} />

      <div className="risk">
        <div>
          <div className="k">You risk</div>
          <div className="v down">{usd(risk)}</div>
        </div>
        <div>
          <div className="k">You win</div>
          <div className="v up">+{usd(win)}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ActionGate
          account={account}
          wallet={wallet}
          needed={needed}
          spender={CFG.cross}
          allowance={wallet.allowCross}
          send={send}
          busy={busy}
          onConnect={onConnect}
          action={
            <button
              className={`btn btn-block ${side === "UP" ? "btn-primary" : "btn-down"}`}
              disabled={!!busy || tooLate || payout <= 0}
              onClick={() =>
                send(
                  CFG.cross,
                  CROSS_ABI,
                  "postChallenge",
                  [w.marketId, side === "UP" ? 0 : 1, unit(payout), Math.round(price * 1e6), opponent || ZERO, 0],
                  "post challenge",
                  `Posted ${side} on ${w.asset} ${w.interval}. Share the link or wait for the vault.`,
                )
              }
            >
              {busy === "post challenge" ? "posting…" : tooLate ? "Window closes too soon" : `Post ${side} at ${price.toFixed(2)}`}
            </button>
          }
        />
      </div>
    </div>
  );
}

/**
 * The reason the old build threw "deposit reverted": it offered the final action first.
 * This walks connect, fund, approve, act in order and only enables the step you are on.
 */
function ActionGate({ account, wallet, needed, spender, allowance, send, busy, onConnect, action, label = "act" }) {
  const funded = wallet.balance >= needed && wallet.balance > 0n;
  const approved = allowance >= needed && needed > 0n;
  const step = !account ? 0 : !funded ? 1 : !approved ? 2 : 3;

  return (
    <>
      <div className="steps-inline">
        <div className={`s ${step > 0 ? "done" : "now"}`}>1 connect</div>
        <div className={`s ${step > 1 ? "done" : step === 1 ? "now" : ""}`}>2 get tUSDC</div>
        <div className={`s ${step > 2 ? "done" : step === 2 ? "now" : ""}`}>3 approve</div>
        <div className={`s ${step === 3 ? "now" : ""}`}>4 {label}</div>
      </div>

      {step === 0 && (
        <button className="btn btn-primary btn-block" onClick={onConnect}>
          Connect wallet
        </button>
      )}

      {step === 1 && (
        <>
          <button
            className="btn btn-primary btn-block"
            disabled={!!busy}
            onClick={() => send(CFG.collateral, erc20Abi, "faucet", [unit(1000)], "get tUSDC", "1000 test tUSDC is in your wallet.")}
          >
            {busy === "get tUSDC" ? "requesting…" : "Get 1000 test tUSDC"}
          </button>
          <p className="card-hint" style={{ margin: "10px 0 0" }}>
            Your wallet holds {usd(human(wallet.balance))} tUSDC. This is a testnet faucet, the tokens are free.
          </p>
        </>
      )}

      {step === 2 && (
        <>
          <button
            className="btn btn-primary btn-block"
            disabled={!!busy}
            onClick={() => send(CFG.collateral, erc20Abi, "approve", [spender, maxUint256], "approve tUSDC", "Approved. You only do this once.")}
          >
            {busy === "approve tUSDC" ? "approving…" : "Approve tUSDC"}
          </button>
          <p className="card-hint" style={{ margin: "10px 0 0" }}>
            One signature lets the contract move the stake you commit. It cannot touch anything else.
          </p>
        </>
      )}

      {step === 3 && action}
    </>
  );
}

function WindowList({ priced, selected, onSelect }) {
  return (
    <div className="card">
      <div className="card-title">Live windows</div>
      <p className="card-hint">
        Every window is a match with a guaranteed other side. Windows inside six minutes of expiry are hidden, because
        they can lock mid-transaction.
      </p>
      {priced.length === 0 && <div className="muted">No open windows right now.</div>}
      {priced.map((w) => (
        <div
          key={w.marketId}
          className={`window-row ${w.marketId === selected ? "active" : ""}`}
          onClick={() => onSelect(w.marketId)}
        >
          <div>
            <span className="asset">{w.asset}</span>
            <span className="chip">{w.interval}</span>
          </div>
          <div className="mono dim" style={{ fontSize: 13 }}>
            open {w.opening ? usd(w.opening) : "…"}
            {w.spot && w.opening && (
              <span className={w.spot >= w.opening ? "up" : "down"}>
                {"   "}
                {w.spot >= w.opening ? "▲" : "▼"} {((w.spot / w.opening - 1) * 100).toFixed(3)}%
              </span>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono">{countdown(w.secondsLeft)}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              UP {w.fairUp == null ? "…" : pct(w.fairUp)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchTable({ matches, account, send, busy }) {
  const rows = matches.filter((m) => m.state !== 0);
  return (
    <div className="card">
      <div className="card-title">Matches</div>
      <p className="card-hint">
        Anyone can settle a resolved match, including you. Payout is exact: you paid a price, the winner takes one.
      </p>
      <table className="matches">
        <thead>
          <tr>
            <th>#</th>
            <th>Maker</th>
            <th>Side</th>
            <th>Payout</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No matches yet. Post the first one.
              </td>
            </tr>
          )}
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="mono">{m.id}</td>
              <td className="mono muted">
                {m.maker.slice(0, 6)}…{m.maker.slice(-4)}
              </td>
              <td className={m.makerSide === 0 ? "up" : "down"} style={{ fontWeight: 600 }}>
                {m.makerSide === 0 ? "UP" : "DOWN"}
              </td>
              <td className="mono">{usd(human(m.contracts))}</td>
              <td>
                <span className={`pill ${STATE[m.state]}`}>{STATE[m.state]}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                {m.state === 1 && account && m.maker.toLowerCase() !== account.toLowerCase() && (
                  <button
                    className="btn"
                    disabled={!!busy}
                    onClick={() => send(CFG.cross, CROSS_ABI, "acceptChallenge", [BigInt(m.id)], `take ${m.id}`, "You are in the match.")}
                  >
                    Take {m.makerSide === 0 ? "DOWN" : "UP"}
                  </button>
                )}
                {m.state === 2 && (
                  <button
                    className="btn"
                    disabled={!!busy}
                    onClick={() => send(CFG.cross, CROSS_ABI, "settle", [BigInt(m.id)], `settle ${m.id}`, "Settled and paid.")}
                  >
                    Settle
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div className="card">
      <div className="card-title">Fade Vault</div>
      <p className="card-hint">
        Deposit and the vault becomes the other side of unmatched challenges, but only when the price beats its own
        fair value by the required edge. This is the side that has to exist for anyone else to play.
      </p>

      <div className="stat-row">
        <div className="stat">
          <div className="k">Pool</div>
          <div className="v">{usd(assets)}</div>
        </div>
        <div className="stat">
          <div className="k">Live risk</div>
          <div className="v">{usd(committed)}</div>
        </div>
        <div className="stat">
          <div className="k">In use</div>
          <div className="v">{Math.round(util * 100)}%</div>
        </div>
      </div>

      {account && vault && vault.mine > 0n && (
        <div className="notice ok" style={{ marginBottom: 16 }}>
          You own {(myShare * 100).toFixed(2)}% of the pool, currently worth {usd(assets * myShare)} tUSDC.
        </div>
      )}

      <label>Amount (tUSDC)</label>
      <input type="number" min="1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />

      <div style={{ marginTop: 16 }}>
        <ActionGate
          account={account}
          wallet={wallet}
          needed={needed}
          spender={CFG.vault}
          allowance={wallet.allowVault}
          send={send}
          busy={busy}
          onConnect={onConnect}
          label="deposit"
          action={
            <button
              className="btn btn-primary btn-block"
              disabled={!!busy || amount <= 0}
              onClick={() => send(CFG.vault, VAULT_ABI, "deposit", [needed], "deposit", "You are the house now.")}
            >
              {busy === "deposit" ? "depositing…" : `Deposit ${usd(amount)} and be the house`}
            </button>
          }
        />
      </div>

      {account && vault?.mine > 0n && (
        <button
          className="btn btn-block"
          style={{ marginTop: 10 }}
          disabled={!!busy}
          onClick={() => send(CFG.vault, VAULT_ABI, "withdraw", [vault.mine], "withdraw", "Withdrawn.")}
        >
          {busy === "withdraw" ? "…" : "Withdraw everything"}
        </button>
      )}

      <p className="card-hint" style={{ margin: "18px 0 0", fontSize: 12.5 }}>
        Underwriting profit and loss, not a yield product. Only idle collateral can be withdrawn, since the rest is
        live in matches until they settle.
      </p>
    </div>
  );
}
