import { useEffect, useState } from "react";
import { Wordmark, Mark } from "./Logo.jsx";
import { CFG, publicClient, liveWindows } from "./chain.js";
import { usd } from "./pricing.js";
import { formatUnits } from "viem";
import vaultArtifact from "../../out/FadeVault.json";

const VAULT_ABI = vaultArtifact.abi;

export default function Landing({ go }) {
  const [stats, setStats] = useState({ windows: null, pool: null, matches: null });

  useEffect(() => {
    let alive = true;
    async function load() {
      const next = {};
      try {
        next.windows = (await liveWindows()).length;
      } catch {
        next.windows = null;
      }
      if (CFG.vault) {
        try {
          const assets = await publicClient.readContract({
            address: CFG.vault,
            abi: VAULT_ABI,
            functionName: "totalAssets",
          });
          next.pool = Number(formatUnits(assets, 6));
        } catch {
          next.pool = null;
        }
      }
      if (alive) setStats((s) => ({ ...s, ...next }));
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <nav className="nav">
        <Wordmark />
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#sides">Two sides</a>
          <a href="https://github.com" onClick={(e) => e.preventDefault()}>
            Docs
          </a>
          <button className="btn btn-primary" onClick={go}>
            Launch app
          </button>
        </div>
      </nav>

      <div className="shell">
        <header className="hero">
          <div className="hero-inner">
            <span className="eyebrow">
              <span className="dot" />
              Live on Somnia Shannon
            </span>
            <h1>
              Two buyers.
              <br />
              <span className="accent-down">No seller.</span> <span className="accent-up">One window.</span>
            </h1>
            <p className="hero-sub">
              Bet a friend on the next fifteen minutes of BTC or ETH and have it settle itself. CROSS matches you
              against a person or a vault, mints both sides of the bet straight from the collateral, and pays the
              winner on chain. No order book. No house edge. No claim button.
            </p>
            <div className="hero-cta">
              <button className="btn btn-primary btn-lg" onClick={go}>
                Start a match
              </button>
              <a className="btn btn-lg btn-ghost" href="#how">
                See how it works
              </a>
            </div>
            <div className="hero-stats">
              <div>
                <div className="k">Live windows</div>
                <div className="v">{stats.windows ?? "--"}</div>
              </div>
              <div>
                <div className="k">Vault pool</div>
                <div className="v">{stats.pool == null ? "--" : usd(stats.pool)}</div>
              </div>
              <div>
                <div className="k">Settlement</div>
                <div className="v up">Automatic</div>
              </div>
              <div>
                <div className="k">Fees</div>
                <div className="v">0%</div>
              </div>
            </div>
          </div>
        </header>

        <section className="band" id="problem">
          <span className="eyebrow">The problem</span>
          <h2>Every bet needs someone on the other side.</h2>
          <p className="lede">
            On an exchange, that someone is a resting order, and on a young venue there often is not one. On a betting
            app, that someone is the house, and you can never be it. Both answers put a stranger between you and the
            person you actually wanted to bet.
          </p>

          <table className="compare">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Who takes the other side</th>
                <th>What happens when the book is thin</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Exchange event contracts</td>
                <td>The house</td>
                <td>You always fill, and you can never be the house</td>
              </tr>
              <tr>
                <td>Prediction market order books</td>
                <td>Whoever is resting a quote</td>
                <td>No depth, no fill, and taker fees on short windows</td>
              </tr>
              <tr className="us">
                <td>CROSS on dreamDEX</td>
                <td>A friend, a stranger, or the vault</td>
                <td>
                  Nothing. The pair is minted from your two stakes, so no order book is touched
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="band" id="how">
          <span className="eyebrow">The mechanic</span>
          <h2>One stake in, two opposite halves out.</h2>
          <p className="lede">
            dreamDEX lets two opposite-side buyers cross with no seller at all: the pool mints a fresh Up and Down pair
            from their combined collateral. CROSS is that single fill path, turned into a product.
          </p>

          <MintDiagram />

          <div className="cols cols-3">
            <div className="step">
              <div className="n">1</div>
              <h3>Post your side</h3>
              <p>
                Pick UP or DOWN and a payout. You put in your share, the app tells you exactly what you risk and exactly
                what you win. Share a link, or leave it on the open board.
              </p>
            </div>
            <div className="step">
              <div className="n">2</div>
              <h3>Someone crosses you</h3>
              <p>
                A friend, a stranger, or the Fade Vault funds the other half. Both stakes become one UP token and one
                DOWN token, held in escrow. No slippage, no partial fill.
              </p>
            </div>
            <div className="step">
              <div className="n">3</div>
              <h3>The window settles itself</h3>
              <p>
                The oracle resolves against the opening price. Anyone can trigger settlement, the winning side is
                redeemed, and the payout lands. A void refunds both sides exactly.
              </p>
            </div>
          </div>
        </section>

        <section className="band" id="sides">
          <span className="eyebrow">Two sides</span>
          <h2>Play the window, or be the one who takes it.</h2>

          <div className="cols cols-2">
            <div className="side-card side-play">
              <h3>Play</h3>
              <p className="dim">
                For anyone who has ever said "bet you it dumps this hour" and had no way to settle it.
              </p>
              <ul>
                <li>Resolves in fifteen minutes, not next November</li>
                <li>Challenge a specific person by link, or anyone at all</li>
                <li>Payout is exact: you pay a price, the winner takes one</li>
                <li>Nothing to claim, the winner is simply paid</li>
              </ul>
              <button className="btn btn-primary btn-block" onClick={go}>
                Start a match
              </button>
            </div>

            <div className="side-card side-house">
              <h3>Be the house</h3>
              <p className="dim">
                Someone has to take the other side. Deposit and the vault does it for you, at a price it chooses.
              </p>
              <ul>
                <li>Prices every window as the digital option it actually is</li>
                <li>Only fills when the offer beats fair value by a set edge</li>
                <li>Risk caps per match, per market, and per pool, enforced on chain</li>
                <li>Underwriting profit and loss, not a yield promise. It can lose</li>
              </ul>
              <button className="btn btn-block" onClick={go}>
                Open the vault
              </button>
            </div>
          </div>
        </section>

        <section className="band">
          <span className="eyebrow">Why it is not a coin flip</span>
          <h2>A window that already moved is not fifty-fifty.</h2>
          <p className="lede">
            Once a window is open, what matters is how far price has travelled from the opening print and how little
            time is left to undo it. The vault prices that properly, which is the difference between taking flow and
            being picked off by it.
          </p>
          <div className="cols cols-2">
            <div className="step">
              <h3 className="mono" style={{ fontSize: 15 }}>
                BTC 15m &middot; 0.27% below open
              </h3>
              <p>Six minutes left. Fair odds of finishing up: <span className="down">0.3%</span></p>
            </div>
            <div className="step">
              <h3 className="mono" style={{ fontSize: 15 }}>
                BTC 4h &middot; 0.40% below open
              </h3>
              <p>Three hours left. Fair odds of finishing up: <span className="up">23.3%</span></p>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Mark size={20} />
            <span>CROSS &middot; built on dreamDEX event contracts, Somnia Shannon testnet</span>
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            {CFG.cross && (
              <a href={`${CFG.explorer}/address/${CFG.cross}`} target="_blank" rel="noreferrer">
                Cross contract
              </a>
            )}
            {CFG.vault && (
              <a href={`${CFG.explorer}/address/${CFG.vault}`} target="_blank" rel="noreferrer">
                Vault contract
              </a>
            )}
            <span>Testnet, unaudited</span>
          </div>
        </footer>
      </div>
    </>
  );
}

function MintDiagram() {
  return (
    <div className="card" style={{ marginTop: 30, padding: 26 }}>
      <svg viewBox="0 0 760 190" style={{ width: "100%", height: "auto" }} role="img" aria-label="Two stakes are minted into an Up token and a Down token">
        <defs>
          <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#46536e" />
          </marker>
        </defs>

        <g fontFamily="var(--mono)" fontSize="12">
          <rect x="8" y="18" width="150" height="52" rx="10" fill="var(--surface-2)" stroke="var(--up)" />
          <text x="83" y="40" textAnchor="middle" fill="var(--up)" fontSize="13" fontWeight="600">
            You
          </text>
          <text x="83" y="58" textAnchor="middle" fill="var(--ink-2)">
            11 USDC on UP
          </text>

          <rect x="8" y="118" width="150" height="52" rx="10" fill="var(--surface-2)" stroke="var(--down)" />
          <text x="83" y="140" textAnchor="middle" fill="var(--down)" fontSize="13" fontWeight="600">
            Them, or the vault
          </text>
          <text x="83" y="158" textAnchor="middle" fill="var(--ink-2)">
            9 USDC on DOWN
          </text>

          <path d="M162 44 C 210 44, 210 82, 258 90" stroke="#46536e" fill="none" markerEnd="url(#ar)" />
          <path d="M162 144 C 210 144, 210 106, 258 96" stroke="#46536e" fill="none" markerEnd="url(#ar)" />

          <rect x="272" y="58" width="186" height="70" rx="12" fill="var(--raised)" stroke="var(--line)" />
          <text x="365" y="84" textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="600">
            pool.mintSet()
          </text>
          <text x="365" y="103" textAnchor="middle" fill="var(--ink-2)">
            20 USDC in
          </text>
          <text x="365" y="118" textAnchor="middle" fill="var(--muted)" fontSize="11">
            no order book touched
          </text>

          <path d="M462 84 C 510 84, 510 48, 556 44" stroke="#46536e" fill="none" markerEnd="url(#ar)" />
          <path d="M462 102 C 510 102, 510 140, 556 144" stroke="#46536e" fill="none" markerEnd="url(#ar)" />

          <rect x="570" y="18" width="182" height="52" rx="10" fill="var(--surface-2)" stroke="var(--up)" />
          <text x="661" y="40" textAnchor="middle" fill="var(--up)" fontSize="13" fontWeight="600">
            20 UP tokens
          </text>
          <text x="661" y="58" textAnchor="middle" fill="var(--ink-2)">
            escrowed for you
          </text>

          <rect x="570" y="118" width="182" height="52" rx="10" fill="var(--surface-2)" stroke="var(--down)" />
          <text x="661" y="140" textAnchor="middle" fill="var(--down)" fontSize="13" fontWeight="600">
            20 DOWN tokens
          </text>
          <text x="661" y="158" textAnchor="middle" fill="var(--ink-2)">
            escrowed for them
          </text>
        </g>
      </svg>
      <p className="card-hint" style={{ margin: "16px 0 0", textAlign: "center" }}>
        When the window closes, the winning token is redeemed for the full 20 and paid out. The losing one is worth
        nothing. That is the entire product.
      </p>
    </div>
  );
}
