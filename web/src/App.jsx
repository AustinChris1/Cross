import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Wordmark } from "./Logo.jsx";
import { CFG, publicClient, walletClient, connect, erc20Abi, liveWindows, openingPrices, spotPrices } from "./chain.js";
import { fairUpProbability, pct, usd, countdown, racePosition } from "./pricing.js";
import crossArtifact from "../../out/Cross.json";
import vaultArtifact from "../../out/FadeVault.json";

const CROSS_ABI = crossArtifact.abi;
const VAULT_ABI = vaultArtifact.abi;
const DEC = 6;
const unit = (n) => parseUnits(String(n), DEC);
const human = (v) => Number(formatUnits(v ?? 0n, DEC));
const STATE = ["none", "open", "filled", "settled", "cancelled"];

export default function App() {
  const [account, setAccount] = useState(null);
  const [windows, setWindows] = useState([]);
  const [opens, setOpens] = useState({});
  const [spots, setSpots] = useState({});
  const [selected, setSelected] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [matches, setMatches] = useState([]);
  const [vault, setVault] = useState(null);
  const [balance, setBalance] = useState(0n);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const configured = CFG.cross && CFG.vault;

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  async function refreshMarkets() {
    try {
      const w = await liveWindows();
      setWindows(w);
      if (!selected && w.length) setSelected(w[0].marketId);
      const [o, s] = await Promise.all([
        openingPrices(w.map((m) => m.marketId)),
        spotPrices([...new Set(w.map((m) => m.asset))]),
      ]);
      setOpens(o);
      setSpots(s);
    } catch (e) {
      setError(`market data: ${e.message}`);
    }
  }

  async function refreshChain() {
    if (!configured) return;
    try {
      const count = Number(await publicClient.readContract({ address: CFG.cross, abi: CROSS_ABI, functionName: "matchCount" }));
      const ids = [];
      for (let i = count; i > Math.max(0, count - 25); i--) ids.push(i);
      const rows = await Promise.all(
        ids.map(async (id) => ({
          id,
          ...(await publicClient.readContract({ address: CFG.cross, abi: CROSS_ABI, functionName: "getMatch", args: [BigInt(id)] })),
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
        mine = await publicClient.readContract({ address: CFG.vault, abi: VAULT_ABI, functionName: "sharesOf", args: [account] });
        setBalance(await publicClient.readContract({ address: CFG.collateral, abi: erc20Abi, functionName: "balanceOf", args: [account] }));
      }
      setVault({ assets, committed, shares, mine });
    } catch (e) {
      setError(`chain read: ${e.message}`);
    }
  }

  useEffect(() => {
    refreshMarkets();
    const t = setInterval(refreshMarkets, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    refreshChain();
    const t = setInterval(refreshChain, 8000);
    return () => clearInterval(t);
  }, [account, configured]);

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

  async function send(address, abi, functionName, args, label) {
    setError("");
    setBusy(label);
    try {
      const wc = walletClient();
      const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
      const hash = await wc.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshChain();
    } catch (e) {
      setError(`${label}: ${(e.shortMessage ?? e.message).slice(0, 200)}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <Wordmark />
          <div className="tagline">Two buyers. No seller. One window.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {account && <span className="muted mono">{usd(human(balance))} tUSDC</span>}
          {account ? (
            <span className="mono muted">
              {account.slice(0, 6)}…{account.slice(-4)}
            </span>
          ) : (
            <button className="ghost" onClick={() => connect().then(setAccount).catch((e) => setError(e.message))}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {!configured && (
        <div className="notice err">
          No contract addresses configured. Deploy with <code>npm run deploy</code>, then set VITE_CROSS_ADDRESS and
          VITE_VAULT_ADDRESS in web/.env.local.
        </div>
      )}
      {error && <div className="notice err">{error}</div>}

      <div className="grid">
        <div>
          <MatchView w={active} account={account} send={send} busy={busy} balance={balance} />
          <Windows priced={priced} selected={selected} onSelect={setSelected} />
          <Matches matches={matches} account={account} send={send} busy={busy} />
        </div>
        <div>
          <VaultPanel vault={vault} account={account} send={send} busy={busy} balance={balance} />
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}

function MatchView({ w, account, send, busy, balance }) {
  const [side, setSide] = useState("UP");
  const [payout, setPayout] = useState(20);
  const [opponent, setOpponent] = useState("");
  if (!w) return <div className="card">Loading live windows…</div>;

  const fair = w.fairUp;
  const price = side === "UP" ? (fair ?? 0.5) : 1 - (fair ?? 0.5);
  const clamped = Math.min(0.95, Math.max(0.05, price));
  const risk = payout * clamped;
  const win = payout - risk;
  const moved = w.opening && w.spot ? (w.spot / w.opening - 1) * 100 : null;
  const racePos = racePosition({ spot: w.spot, opening: w.opening, intervalSec: w.intervalSec });
  const progress = w.intervalSec ? Math.min(1, Math.max(0, 1 - w.secondsLeft / w.intervalSec)) : 0;

  const canPost = account && payout > 0 && w.secondsLeft > 360;

  return (
    <div className="card">
      <h2>The match</h2>
      <p className="hint">
        {w.asset} {w.interval} window. The line to beat is the opening print, exactly as the oracle settles it.
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="asset" style={{ fontSize: 18 }}>
            {w.asset}
          </span>
          <span className="chip">{w.interval}</span>
          <span className="chip">{w.trades} trades</span>
        </div>
        <div className="clock">{countdown(w.secondsLeft)}</div>
      </div>

      <div className="race">
        <div className="open-line" />
        <div className="open-label mono">open {w.opening ? usd(w.opening) : "…"}</div>
        {w.spot && w.opening && (
          <>
            <div
              className="spot-dot"
              style={{ top: `${racePos}%`, borderColor: w.spot >= w.opening ? "var(--up)" : "var(--down)" }}
            />
            <div
              className="spot-label mono"
              style={{
                top: `${racePos}%`,
                color: w.spot >= w.opening ? "var(--up)" : "var(--down)",
              }}
            >
              {usd(w.spot)} {moved != null && `(${moved >= 0 ? "+" : ""}${moved.toFixed(3)}%)`}
            </div>
          </>
        )}
      </div>

      <div className="bar">
        <span style={{ width: `${(fair ?? 0.5) * 100}%` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }} className="muted">
        <span>
          UP <b className="up">{fair == null ? "…" : pct(fair)}</b>
        </span>
        <span className="mono">{Math.round(progress * 100)}% of window elapsed</span>
        <span>
          DOWN <b className="down">{fair == null ? "…" : pct(1 - fair)}</b>
        </span>
      </div>

      <label>Your side</label>
      <div className="side-toggle">
        <button className={side === "UP" ? "sel-up" : ""} onClick={() => setSide("UP")}>
          UP
        </button>
        <button className={side === "DOWN" ? "sel-down" : ""} onClick={() => setSide("DOWN")}>
          DOWN
        </button>
      </div>

      <label>Payout to the winner (tUSDC)</label>
      <input type="number" min="1" value={payout} onChange={(e) => setPayout(Number(e.target.value))} />

      <label>Challenge someone specific (optional address)</label>
      <input placeholder="0x… leave blank for the open board" value={opponent} onChange={(e) => setOpponent(e.target.value)} />

      <div className="risk">
        <div>
          <div className="muted">You risk</div>
          <div className="big down">{usd(risk)}</div>
        </div>
        <div>
          <div className="muted">You win</div>
          <div className="big up">+{usd(win)}</div>
        </div>
      </div>

      <button
        className="primary"
        disabled={!canPost || !!busy}
        onClick={() =>
          send(
            CFG.cross,
            CROSS_ABI,
            "postChallenge",
            [
              w.marketId,
              side === "UP" ? 0 : 1,
              unit(payout),
              Math.round(clamped * 1e6),
              opponent || "0x0000000000000000000000000000000000000000",
              0,
            ],
            "post challenge",
          )
        }
      >
        {busy === "post challenge" ? "posting…" : account ? `Post ${side} at ${clamped.toFixed(2)}` : "Connect wallet to post"}
      </button>
      <p className="hint" style={{ marginTop: 10 }}>
        Approve tUSDC for Cross once before your first post. Balance {usd(human(balance))}.
      </p>
      <button
        className="ghost"
        style={{ width: "100%" }}
        onClick={() => send(CFG.collateral, erc20Abi, "approve", [CFG.cross, unit(100000)], "approve")}
        disabled={!account || !!busy}
      >
        {busy === "approve" ? "approving…" : "Approve tUSDC"}
      </button>
      <button
        className="ghost"
        style={{ width: "100%", marginTop: 8 }}
        onClick={() => send(CFG.collateral, erc20Abi, "faucet", [unit(1000)], "faucet")}
        disabled={!account || !!busy}
      >
        {busy === "faucet" ? "…" : "Get 1000 test tUSDC"}
      </button>
    </div>
  );
}

function Windows({ priced, selected, onSelect }) {
  return (
    <div className="card">
      <h2>Live windows</h2>
      <p className="hint">Every window is a match with a guaranteed other side. Windows inside 6 minutes of expiry are hidden.</p>
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
          <div className="muted mono">
            {w.opening ? `open ${usd(w.opening)}` : "opening…"}
            {w.spot && w.opening && (
              <span className={w.spot >= w.opening ? "up" : "down"}>
                {"  "}
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

function Matches({ matches, account, send, busy }) {
  const rows = matches.filter((m) => m.state !== 0);
  return (
    <div className="card">
      <h2>Matches</h2>
      <p className="hint">Anyone can settle a resolved match. Payout is exact: you paid a price, the winner takes one.</p>
      <table>
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
                No matches yet. Post one above.
              </td>
            </tr>
          )}
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="mono">{m.id}</td>
              <td className="mono muted">
                {m.maker.slice(0, 6)}…{m.maker.slice(-4)}
              </td>
              <td className={m.makerSide === 0 ? "up" : "down"}>{m.makerSide === 0 ? "UP" : "DOWN"}</td>
              <td className="mono">{usd(human(m.contracts))}</td>
              <td>
                <span className={`state ${STATE[m.state]}`}>{STATE[m.state]}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                {m.state === 1 && account && m.maker.toLowerCase() !== account.toLowerCase() && (
                  <button
                    className="ghost"
                    disabled={!!busy}
                    onClick={() => send(CFG.cross, CROSS_ABI, "acceptChallenge", [BigInt(m.id)], `take ${m.id}`)}
                  >
                    Take {m.makerSide === 0 ? "DOWN" : "UP"}
                  </button>
                )}
                {m.state === 2 && (
                  <button
                    className="ghost"
                    disabled={!!busy}
                    onClick={() => send(CFG.cross, CROSS_ABI, "settle", [BigInt(m.id)], `settle ${m.id}`)}
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

function VaultPanel({ vault, account, send, busy, balance }) {
  const [amount, setAmount] = useState(100);
  const assets = human(vault?.assets);
  const committed = human(vault?.committed);
  const util = assets > 0 ? committed / assets : 0;
  const myShare = vault && vault.shares > 0n ? Number(vault.mine) / Number(vault.shares) : 0;

  return (
    <div className="card">
      <h2>Fade Vault</h2>
      <p className="hint">
        Deposit and the vault becomes the other side of unmatched challenges, only when the price beats its own fair
        value by the required edge. This is the side that has to exist for anyone else to play.
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
          <div className="k">Utilisation</div>
          <div className="v">{Math.round(util * 100)}%</div>
        </div>
      </div>
      {account && vault && (
        <p className="hint">
          Your share {(myShare * 100).toFixed(2)}%, worth {usd(assets * myShare)} tUSDC.
        </p>
      )}
      <label>Amount (tUSDC)</label>
      <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      <button
        className="primary"
        disabled={!account || !!busy}
        onClick={() => send(CFG.vault, VAULT_ABI, "deposit", [unit(amount)], "deposit")}
      >
        {busy === "deposit" ? "depositing…" : "Deposit and be the house"}
      </button>
      <button
        className="ghost"
        style={{ width: "100%", marginTop: 8 }}
        disabled={!account || !!busy}
        onClick={() => send(CFG.collateral, erc20Abi, "approve", [CFG.vault, unit(100000)], "approve vault")}
      >
        {busy === "approve vault" ? "…" : "Approve tUSDC for vault"}
      </button>
      <button
        className="ghost"
        style={{ width: "100%", marginTop: 8 }}
        disabled={!account || !!busy || !vault?.mine}
        onClick={() => send(CFG.vault, VAULT_ABI, "withdraw", [vault.mine], "withdraw")}
      >
        {busy === "withdraw" ? "…" : "Withdraw my shares"}
      </button>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="card">
      <h2>How a match settles</h2>
      <ol className="hint" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
        <li>You post a side and a payout. Your stake is escrowed.</li>
        <li>A friend, a stranger, or the vault funds the other side.</li>
        <li>
          Cross calls <code>mintSet</code> on the pool: your two stakes become one UP and one DOWN token. No order book
          is touched, so a thin book cannot stop the fill.
        </li>
        <li>The oracle resolves the window against its opening print.</li>
        <li>Anyone settles. Cross redeems the winning leg and pays the winner. A void refunds both sides exactly.</li>
      </ol>
      <p className="hint">
        Contracts on{" "}
        <a href={`${CFG.explorer}/address/${CFG.cross}`} target="_blank" rel="noreferrer">
          Shannon explorer
        </a>
        .
      </p>
    </div>
  );
}
