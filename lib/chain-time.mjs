// The chain's clock, not the machine's. Every window guard and every option price is measured
// against block.timestamp on chain, so a local clock that drifts silently corrupts both: it
// picks dead markets, skips live ones, and feeds the wrong time-to-expiry into fair value.
let offset = 0;
let synced = false;

/** Measures the drift between the chain and this machine. Call once at startup, then refresh. */
export async function syncChainTime(publicClient) {
  const block = await publicClient.getBlock();
  offset = Number(block.timestamp) - Math.floor(Date.now() / 1000);
  synced = true;
  return offset;
}

/** Unix seconds as the chain sees them. Falls back to the local clock until the first sync. */
export function chainNow() {
  return Math.floor(Date.now() / 1000) + offset;
}

export function chainDrift() {
  return { offset, synced };
}

/** Keeps the offset fresh; a long-running process should not trust one reading forever. */
export function keepChainTimeSynced(publicClient, everyMs = 60_000) {
  const t = setInterval(() => {
    syncChainTime(publicClient).catch(() => {});
  }, everyMs);
  if (t.unref) t.unref();
  return () => clearInterval(t);
}
