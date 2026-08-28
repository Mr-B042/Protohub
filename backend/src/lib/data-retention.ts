import { logger } from "./logger.js";
import { supabase } from "./supabase.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_RETENTION_DAYS = Math.max(14, Number(process.env.NOTIFICATION_RETENTION_DAYS) || 30);
const PDA_ORPHAN_GRACE_HOURS = Math.max(24, Number(process.env.PDA_ORPHAN_GRACE_HOURS) || 7 * 24);
const PDA_BUCKET = "pda-kyc";

type StoredObject = { path: string; createdAt: string | null };

async function listStoredObjects(path = ""): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(PDA_BUCKET).list(path, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.id == null && entry.metadata == null) folders.push(childPath);
      else objects.push({ path: childPath, createdAt: entry.created_at ?? null });
    }
    if (entries.length < 1000) break;
  }
  for (const folder of folders) objects.push(...await listStoredObjects(folder));
  return objects;
}

async function referencedPdaMediaPaths(): Promise<Set<string>> {
  const queries = await Promise.all([
    supabase.from("pda_kyc_items").select("file_url").not("file_url", "is", null),
    supabase.from("pda_documents").select("signed_file_url").not("signed_file_url", "is", null),
    supabase.from("pda_guarantors").select("id_document_url,photo_url,signed_form_url"),
    supabase.from("pda_order_assignments").select("proof_file_path").not("proof_file_path", "is", null),
    supabase.from("pda_stock_transfers").select("proof_file_path").not("proof_file_path", "is", null),
    supabase.from("pda_stock_discrepancies").select("proof_file_path").not("proof_file_path", "is", null)
  ]);
  const failed = queries.find((query) => query.error);
  if (failed?.error) throw failed.error;
  const paths = new Set<string>();
  for (const query of queries) {
    for (const row of query.data ?? []) {
      for (const value of Object.values(row)) {
        if (typeof value === "string" && value) paths.add(value);
      }
    }
  }
  return paths;
}

export function orphanedPdaMediaPaths(objects: StoredObject[], references: Set<string>, now = Date.now()): string[] {
  const cutoff = now - PDA_ORPHAN_GRACE_HOURS * 60 * 60 * 1000;
  return objects
    .filter((object) => !references.has(object.path))
    .filter((object) => object.createdAt != null && Date.parse(object.createdAt) < cutoff)
    .map((object) => object.path);
}

export async function pruneOldReadNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS).toISOString();
  const { count, error } = await supabase
    .from("system_notifications")
    .delete({ count: "exact" })
    .eq("read", true)
    .lt("created_at", cutoff);
  if (error) throw error;
  return count ?? 0;
}

export async function pruneOrphanedPdaMedia(): Promise<number> {
  const [objects, references] = await Promise.all([listStoredObjects(), referencedPdaMediaPaths()]);
  const orphaned = orphanedPdaMediaPaths(objects, references);
  let removed = 0;
  for (let start = 0; start < orphaned.length; start += 100) {
    const batch = orphaned.slice(start, start + 100);
    const { data, error } = await supabase.storage.from(PDA_BUCKET).remove(batch);
    if (error) throw error;
    removed += data?.length ?? 0;
  }
  return removed;
}

export async function runStorageRetention(): Promise<void> {
  const [notifications, media] = await Promise.allSettled([
    pruneOldReadNotifications(),
    pruneOrphanedPdaMedia()
  ]);
  if (notifications.status === "fulfilled") logger.info("retention: old read notifications removed", { deleted: notifications.value });
  else logger.error("retention: notification cleanup failed", { error: notifications.reason?.message ?? String(notifications.reason) });
  if (media.status === "fulfilled") logger.info("retention: orphaned PDA media removed", { deleted: media.value });
  else logger.error("retention: PDA media cleanup failed", { error: media.reason?.message ?? String(media.reason) });
}
