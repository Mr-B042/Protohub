import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// A stable-per-process identity. Railway sets RAILWAY_REPLICA_ID per replica; the
// random suffix guarantees uniqueness even when those env vars are absent.
const HOLDER_ID = `${process.env.RAILWAY_REPLICA_ID ?? process.env.RAILWAY_INSTANCE_ID ?? process.env.HOSTNAME ?? "instance"}-${randomUUID().slice(0, 8)}`;

const LEASE_TTL_SECONDS = 60;
const HEARTBEAT_MS = 25_000;
const FOLLOWER_RETRY_MS = 20_000;

async function tryClaim(name: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_runtime_singleton", {
    p_name: name,
    p_holder: HOLDER_ID,
    p_ttl_seconds: LEASE_TTL_SECONDS
  });
  if (error) {
    // Availability first: if the lease mechanism itself is unavailable, do NOT
    // silently leave the runtime unstarted — assume leadership and warn.
    logger.warn("runtime-lease: claim failed, assuming leader", { name, error: error.message });
    return true;
  }
  return data === true;
}

/**
 * Run `start` on exactly ONE backend instance — the lease holder. Other instances
 * wait and take over only if the holder's heartbeat goes stale (i.e. it died).
 * `start` is invoked at most once per process. Prevents two instances from each
 * opening a Baileys socket on the same WhatsApp number (session conflicts / ban
 * risk) and hammering the shared session row.
 */
export function runAsSingleton(name: string, start: () => void): void {
  let started = false;
  const elect = async () => {
    const isLeader = await tryClaim(name).catch(() => true);
    if (started) return;
    if (isLeader) {
      started = true;
      logger.info("runtime-lease: acquired — starting runtime", { name, holder: HOLDER_ID });
      try { start(); } catch (err) { logger.warn("runtime-lease: start threw", { name, error: (err as Error).message }); }
      // Keep the lease alive so followers don't take over while we're healthy.
      setInterval(() => { void tryClaim(name).catch(() => {}); }, HEARTBEAT_MS);
    } else {
      logger.info("runtime-lease: another instance holds it — standing by", { name, holder: HOLDER_ID });
      setTimeout(() => { void elect(); }, FOLLOWER_RETRY_MS);
    }
  };
  void elect();
}
