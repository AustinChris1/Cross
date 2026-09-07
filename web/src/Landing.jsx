import { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useSpring, useScroll, useTransform } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  ArrowUpRight,
  Coins,
  Handshake,
  Link2,
  Lock,
  ShieldCheck,
  Split,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { Wordmark, Mark } from "./Logo.jsx";
import { CFG, publicClient, liveWindows, openingPrices, spotPrices, syncChainTime, chainNow } from "./chain.js";
import { usd, fairUpProbability, countdown } from "./pricing.js";
import { formatUnits } from "viem";
import abis from "./abis.json";

gsap.registerPlugin(ScrollTrigger);
const VAULT_ABI = abis.FadeVault;

const ease = [0.22, 1, 0.36, 1];
const rise = {
  hidden: { opacity: 0, y: 26 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: i * 0.08, ease } }),
};

function Reveal({ children, delay = 0, className = "" }) {
  return (
    <motion.div
      className={className}
      variants={rise}
      custom={delay}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </motion.div>
  );
}

/** Counts to a value once it scrolls into view. */
function Counter({ to, decimals = 0, prefix = "", suffix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  // Snappy on purpose: a slow count means the hero shows a number that is briefly wrong.
  const spring = useSpring(mv, { stiffness: 170, damping: 24 });
  const [shown, setShown] = useState("0");
  useEffect(() => {
    if (inView && to != null) mv.set(to);
  }, [inView, to, mv]);
  useEffect(() => spring.on("change", (v) => setShown(v.toFixed(decimals))), [spring, decimals]);
  if (to == null) return <span ref={ref}>--</span>;
  return (
    <span ref={ref} className="mono">
      {prefix}
      {Number(shown).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

export default function Landing({ go }) {
  const [stats, setStats] = useState({ windows: null, pool: null });
  const [ticker, setTicker] = useState([]);
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const heroFade = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const w = await liveWindows();
        const [o, s] = await Promise.all([
          openingPrices(w.map((m) => m.marketId)),
          spotPrices([...new Set(w.map((m) => m.asset))]),
        ]);
        await syncChainTime().catch(() => {});
        const now = chainNow();
        const rows = w.slice(0, 8).map((m) => {
          const opening = o[m.marketId.toLowerCase()] ?? null;
          const spot = s[m.asset] ?? null;
          return {
            ...m,
            opening,
            spot,
            secondsLeft: m.expiry - now,
            fairUp: opening && spot ? fairUpProbability({ spot, opening, secondsLeft: m.expiry - now, vol: 0.3 }) : null,
          };
        });
        if (!alive) return;
        setTicker(rows);
        setStats((p) => ({ ...p, windows: w.length }));
      } catch {
        /* landing still renders without live data */
      }
      if (CFG.vault) {
        try {
          const assets = await publicClient.readContract({
            address: CFG.vault,
            abi: VAULT_ABI,
            functionName: "totalAssets",
          });
          if (alive) setStats((p) => ({ ...p, pool: Number(formatUnits(assets, 6)) }));
        } catch {
          /* no vault yet */
        }
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="relative">
      <Nav go={go} />

      {/* hero */}
      <section ref={heroRef} className="relative overflow-hidden px-6 pt-28 pb-24">
        <div className="aurora" />
        <motion.div style={{ y: heroY, opacity: heroFade }} className="relative mx-auto max-w-6xl">
          <motion.div
            variants={rise}
            initial="hidden"
            animate="show"
            className="inline-flex items-center gap-2 rounded-full hairline bg-surface/60 px-3 py-1.5 text-[11px] tracking-[0.18em] text-muted uppercase mono"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-up" />
            </span>
            Live on Somnia Shannon
          </motion.div>

          <motion.h1
            variants={rise}
            custom={1}
            initial="hidden"
            animate="show"
            className="mt-7 text-[clamp(46px,8.5vw,104px)] leading-[0.94]"
          >
            Two buyers.
            <br />
            <span className="text-down">No seller.</span> <span className="text-up">One window.</span>
          </motion.h1>

          <motion.p
            variants={rise}
            custom={2}
            initial="hidden"
            animate="show"
            className="mt-7 max-w-xl text-lg text-ink-2"
          >
            Bet anyone on the next fifteen minutes. Settles itself, on chain.
          </motion.p>

          <motion.div variants={rise} custom={3} initial="hidden" animate="show" className="mt-9 flex flex-wrap gap-3">
            <Magnetic>
              <button
                onClick={go}
                className="group inline-flex items-center gap-2 rounded-xl bg-up px-6 py-3.5 font-semibold text-[#05231a] transition hover:brightness-110"
              >
                Start a match
                <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </button>
            </Magnetic>
            <a
              href="#mechanic"
              className="inline-flex items-center gap-2 rounded-xl hairline px-6 py-3.5 font-medium text-ink-2 transition hover:text-ink hover:border-white/25"
            >
              See the mechanic
            </a>
          </motion.div>

          <motion.div
            variants={rise}
            custom={4}
            initial="hidden"
            animate="show"
            className="mt-14 grid max-w-2xl grid-cols-2 gap-x-10 gap-y-6 border-t border-line pt-7 sm:grid-cols-4"
          >
            <Stat icon={Timer} label="Live windows" value={<Counter to={stats.windows} />} />
            <Stat icon={Coins} label="Vault pool" value={<Counter to={stats.pool} decimals={0} />} />
            <Stat icon={Zap} label="Settlement" value={<span className="text-up">Auto</span>} />
            <Stat icon={ShieldCheck} label="Fees" value={<span>0%</span>} />
          </motion.div>
        </motion.div>
      </section>

      <Ticker rows={ticker} />

      <Mechanic />

      <Sides go={go} />

      <Odds />

      <Footer go={go} />
    </div>
  );
}

function Nav({ go }) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <motion.nav
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease }}
      className={`sticky top-0 z-50 flex items-center justify-between px-6 py-4 transition ${
        solid ? "glass border-b border-line" : ""
      }`}
    >
      <Wordmark size={28} />
      <div className="flex items-center gap-6 text-sm text-ink-2">
        <a href="#mechanic" className="hidden transition hover:text-ink sm:block">
          Mechanic
        </a>
        <a href="#sides" className="hidden transition hover:text-ink sm:block">
          Two sides
        </a>
        <Magnetic>
          <button
            onClick={go}
            className="inline-flex items-center gap-1.5 rounded-lg bg-up px-4 py-2 text-sm font-semibold text-[#05231a] transition hover:brightness-110"
          >
            Launch app
            <ArrowUpRight className="size-3.5" />
          </button>
        </Magnetic>
      </div>
    </motion.nav>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] text-muted">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-medium">{value}</div>
    </div>
  );
}

/** Buttons that lean toward the cursor. Small touch, makes the page feel alive. */
function Magnetic({ children }) {
  const ref = useRef(null);
  const x = useSpring(useMotionValue(0), { stiffness: 250, damping: 18 });
  const y = useSpring(useMotionValue(0), { stiffness: 250, damping: 18 });
  return (
    <motion.div
      ref={ref}
      style={{ x, y }}
      onMouseMove={(e) => {
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.35);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

function Ticker({ rows }) {
  if (!rows.length) return null;
  const doubled = [...rows, ...rows];
  return (
    <div className="relative overflow-hidden border-y border-line bg-surface/40 py-4">
      <div className="marquee">
        {doubled.map((r, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl hairline bg-surface px-4 py-2.5">
            <span className="display text-sm font-bold">{r.asset}</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] mono text-ink-2">{r.interval}</span>
            {r.opening && r.spot && (
              <span className={`mono text-xs ${r.spot >= r.opening ? "text-up" : "text-down"}`}>
                {r.spot >= r.opening ? <TrendingUp className="inline size-3" /> : <TrendingDown className="inline size-3" />}{" "}
                {((r.spot / r.opening - 1) * 100).toFixed(3)}%
              </span>
            )}
            <span className="mono text-xs text-muted">{countdown(Math.max(0, r.secondsLeft))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The mechanic, pinned and scrubbed with GSAP: two stakes fly together, the pool mints,
 * and a single unit splits into an UP token and a DOWN token.
 */
function Mechanic() {
  const scope = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        scrollTrigger: { trigger: ".mech-stage", start: "top 78%", toggleActions: "play none none none" },
      });
      tl.fromTo(".mech-a", { x: -70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7 })
        .fromTo(".mech-b", { x: -70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7 }, "<0.1")
        .fromTo(
          ".mech-flow-in",
          { opacity: 0, rotate: -90, transformOrigin: "50% 50%" },
          { opacity: 1, rotate: 0, duration: 0.9 },
          "<0.1",
        )
        .fromTo(".mech-core", { scale: 0.78, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7 }, "<0.05")
        .fromTo(".mech-up", { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7 }, "<0.15")
        .fromTo(".mech-down", { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7 }, "<0.1")
        .fromTo(".mech-flow-out", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6 }, "<0.15");
    }, scope);
    return () => ctx.revert();
  }, []);

  return (
    <section id="mechanic" ref={scope} className="relative px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="mono text-[11px] uppercase tracking-[0.2em] text-muted">The mechanic</span>
          <h2 className="mt-3 max-w-2xl text-[clamp(30px,4.6vw,52px)] leading-tight">
            One stake in. Two opposite halves out.
          </h2>
        </Reveal>

        <div className="mech-stage mt-14 rounded-3xl hairline bg-surface/50 p-6 sm:p-10">
          <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-4">
              <TokenCard className="mech-a" tone="up" icon={Users} title="You" sub="11 on UP" />
              <TokenCard className="mech-b" tone="down" icon={Users} title="Them, or the vault" sub="9 on DOWN" />
            </div>

            <div className="mech-core relative mx-auto flex size-44 flex-col items-center justify-center rounded-2xl hairline bg-raised sm:size-52">
              <Split className="size-7 text-violet" />
              <div className="mono mt-3 text-sm font-semibold">mintSet()</div>
              <div className="mono mt-1 text-xs text-ink-2">20 in</div>
              <div className="mt-2 text-center text-[10.5px] leading-tight text-muted">
                no order book
                <br />
                touched
              </div>
              <svg className="pointer-events-none absolute -inset-6" viewBox="0 0 240 240" fill="none">
                <circle
                  cx="120"
                  cy="120"
                  r="112"
                  stroke="var(--color-violet)"
                  strokeOpacity="0.32"
                  strokeWidth="1"
                  className="dash mech-flow-in"
                />
              </svg>
            </div>

            <div className="space-y-4">
              <TokenCard className="mech-up" tone="up" icon={TrendingUp} title="20 UP" sub="escrowed for you" />
              <TokenCard className="mech-down" tone="down" icon={TrendingDown} title="20 DOWN" sub="escrowed for them" />
            </div>
          </div>

          <div className="mech-flow-out mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-line pt-7 text-sm text-ink-2">
            <span className="inline-flex items-center gap-2">
              <Lock className="size-4 text-up" /> No slippage
            </span>
            <span className="inline-flex items-center gap-2">
              <Handshake className="size-4 text-up" /> Always a counterparty
            </span>
            <span className="inline-flex items-center gap-2">
              <Zap className="size-4 text-up" /> Pays itself out
            </span>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Wallet, t: "Post", d: "Pick a side and a payout." },
            { icon: Link2, t: "Cross", d: "A person or the vault takes the other half." },
            { icon: Zap, t: "Settle", d: "The oracle calls it. The winner is paid." },
          ].map((s, i) => (
            <Reveal key={s.t} delay={i}>
              <div className="group h-full rounded-2xl hairline bg-surface p-6 transition hover:border-white/20">
                <s.icon className="size-5 text-up transition group-hover:scale-110" />
                <h3 className="mt-4 text-lg">{s.t}</h3>
                <p className="mt-1 text-sm text-ink-2">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function TokenCard({ className = "", tone, icon: Icon, title, sub }) {
  const color = tone === "up" ? "text-up" : "text-down";
  const ring = tone === "up" ? "hover:border-up/50" : "hover:border-down/50";
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={`${className} flex items-center gap-3 rounded-2xl hairline bg-surface px-5 py-4 transition ${ring}`}
    >
      <div className={`grid size-10 place-items-center rounded-xl bg-raised ${color}`}>
        <Icon className="size-5" />
      </div>
      <div>
        <div className={`display text-sm font-bold ${color}`}>{title}</div>
        <div className="mono text-xs text-ink-2">{sub}</div>
      </div>
    </motion.div>
  );
}

function Sides({ go }) {
  const cards = [
    {
      tone: "up",
      icon: Users,
      title: "Play",
      lines: [
        [Timer, "Resolves in 15 minutes"],
        [Link2, "Challenge anyone by link"],
        [ShieldCheck, "Exact payout, no slippage"],
      ],
      cta: "Start a match",
    },
    {
      tone: "violet",
      icon: Coins,
      title: "Be the house",
      lines: [
        [TrendingUp, "Prices every window properly"],
        [ShieldCheck, "Risk caps enforced on chain"],
        [Handshake, "Takes the side nobody else will"],
      ],
      cta: "Open the vault",
    },
  ];
  return (
    <section id="sides" className="relative px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="mono text-[11px] uppercase tracking-[0.2em] text-muted">Two sides</span>
          <h2 className="mt-3 max-w-2xl text-[clamp(30px,4.6vw,52px)] leading-tight">
            Play the window, or take it.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i}>
              <motion.div
                whileHover={{ y: -6 }}
                transition={{ duration: 0.3, ease }}
                className="relative h-full overflow-hidden rounded-3xl hairline bg-gradient-to-b from-surface-2 to-surface p-8"
              >
                <div
                  className={`grid size-12 place-items-center rounded-2xl bg-raised ${
                    c.tone === "up" ? "text-up" : "text-violet"
                  }`}
                >
                  <c.icon className="size-6" />
                </div>
                <h3 className="mt-6 text-3xl">{c.title}</h3>
                <ul className="mt-6 space-y-3">
                  {c.lines.map(([Icon, text]) => (
                    <li key={text} className="flex items-center gap-3 text-sm text-ink-2">
                      <Icon className={`size-4 ${c.tone === "up" ? "text-up" : "text-violet"}`} />
                      {text}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={go}
                  className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold transition ${
                    c.tone === "up"
                      ? "bg-up text-[#05231a] hover:brightness-110"
                      : "hairline text-ink hover:border-violet/60"
                  }`}
                >
                  {c.cta}
                  <ArrowRight className="size-4" />
                </button>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Odds() {
  const rows = [
    { label: "15m", moved: "-0.27%", left: "6 min left", fair: 0.3, tone: "down" },
    { label: "4h", moved: "-0.40%", left: "3 hrs left", fair: 23.3, tone: "up" },
  ];
  return (
    <section className="relative px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="mono text-[11px] uppercase tracking-[0.2em] text-muted">Fair value</span>
          <h2 className="mt-3 max-w-2xl text-[clamp(30px,4.6vw,52px)] leading-tight">
            A window that already moved is not a coin flip.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {rows.map((r, i) => (
            <Reveal key={r.label} delay={i}>
              <div className="rounded-2xl hairline bg-surface p-7">
                <div className="flex items-center justify-between">
                  <span className="display text-lg font-bold">BTC {r.label}</span>
                  <span className="mono text-sm text-down">{r.moved}</span>
                </div>
                <div className="mono mt-1 text-xs text-muted">{r.left}</div>
                <div className="mt-6 h-2 overflow-hidden rounded-full bg-down/70">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${r.fair}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.1, ease }}
                    className="h-full bg-up"
                  />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className={`mono text-3xl font-medium ${r.tone === "up" ? "text-up" : "text-down"}`}>
                    <Counter to={r.fair} decimals={1} suffix="%" />
                  </span>
                  <span className="text-sm text-muted">odds of finishing up</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer({ go }) {
  return (
    <footer className="relative overflow-hidden border-t border-line px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            <div>
              <Mark size={38} />
              <h3 className="mt-5 text-3xl">Two buyers. No seller.</h3>
            </div>
            <Magnetic>
              <button
                onClick={go}
                className="inline-flex items-center gap-2 rounded-xl bg-up px-7 py-4 font-semibold text-[#05231a] transition hover:brightness-110"
              >
                Launch app
                <ArrowRight className="size-4" />
              </button>
            </Magnetic>
          </div>
        </Reveal>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-7 text-xs text-muted">
          <span>Built on dreamDEX event contracts, Somnia Shannon testnet. Unaudited.</span>
          <div className="flex gap-5">
            {CFG.cross && (
              <a
                className="inline-flex items-center gap-1 transition hover:text-ink"
                href={`${CFG.explorer}/address/${CFG.cross}`}
                target="_blank"
                rel="noreferrer"
              >
                Cross <ArrowUpRight className="size-3" />
              </a>
            )}
            {CFG.vault && (
              <a
                className="inline-flex items-center gap-1 transition hover:text-ink"
                href={`${CFG.explorer}/address/${CFG.vault}`}
                target="_blank"
                rel="noreferrer"
              >
                Vault <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
