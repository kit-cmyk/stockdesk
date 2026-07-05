// Offline sync: every mutation is mirrored into an outbox, then flushed to
// Supabase when online + configured + signed in. If cloud is not enabled, the
// outbox simply accumulates harmlessly (and the app works 100% locally).
//
// Push:  strict FIFO by monotonic `seq`. Transient failures stop the flush so
//        later rows never overtake earlier ones; permanent failures (bad data,
//        constraint violations) are flagged and skipped so they can't block
//        the queue, and are surfaced in Settings for retry/discard.
// Pull:  per-table delta reads (`updated_at`/`created_at > last pull`) with
//        last-write-wins against local rows; rows with pending local edits in
//        the outbox are never overwritten.
// Owner: the first signed-in account is bound to this device's data (meta
//        `owner_user_id`). A different account signing in later must reset
//        local data first — nothing is pushed or pulled across accounts.

import { db, getMeta, PROFILE_ID, setMeta } from "./db";
import type { Counter, OutboxEntry } from "./types";
import { getSupabase, isCloudEnabled } from "./supabase";
import { newId, nowIso } from "./utils";

const ENTITY_TABLE: Record<OutboxEntry["entity"], string> = {
  product: "products",
  movement: "stock_movements",
  category: "categories",
  supplier: "suppliers",
  customer: "customers",
  profile: "profiles",
  stock_count: "stock_counts",
  stock_count_item: "stock_count_items",
  order: "orders",
  order_item: "order_items",
  invoice: "invoices",
  payment: "payments",
};

export const OWNER_KEY = "owner_user_id";
const LAST_SYNC_KEY = "last_sync_at";

export async function enqueue(
  entity: OutboxEntry["entity"],
  op: OutboxEntry["op"],
  payload: unknown
): Promise<void> {
  // Allocate the next seq inside a transaction so concurrent enqueues can't tie.
  await db.transaction("rw", db.outbox, async () => {
    const last = await db.outbox.orderBy("seq").last();
    const entry: OutboxEntry = {
      id: newId(),
      entity,
      op,
      payload,
      created_at: nowIso(),
      seq: (last?.seq ?? 0) + 1,
      attempts: 0,
    };
    await db.outbox.put(entry);
  });
  // Flush soon — but never from inside the caller's Dexie transaction zone
  // (a network await inside it would kill the transaction).
  requestFlushSoon();
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a sync on a fresh macrotask, outside any Dexie transaction zone. */
export function requestFlushSoon(): void {
  if (typeof window === "undefined") return;
  if (!navigator.onLine || !isCloudEnabled) return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void syncNow();
  }, 50);
}

// ---------------------------------------------------------------------------
// Session / owner gating
// ---------------------------------------------------------------------------

async function getSessionUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export type OwnerCheck = "ok" | "no-session" | "mismatch";

/**
 * Bind the device's local data to the first account that signs in; refuse to
 * sync for any other account until local data is reset.
 */
export async function checkOwnerBinding(): Promise<OwnerCheck> {
  const userId = await getSessionUserId();
  if (!userId) return "no-session";
  const bound = await getMeta(OWNER_KEY);
  if (!bound) {
    await setMeta(OWNER_KEY, userId);
    return "ok";
  }
  return bound === userId ? "ok" : "mismatch";
}

// ---------------------------------------------------------------------------
// Payload preparation (client row -> server row) + error classification
// ---------------------------------------------------------------------------

/** Postgres/PostgREST error codes that will never succeed on retry. */
function isPermanentError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (/^2[23]/.test(code)) return true; // data exception / integrity constraint
  if (code.startsWith("42")) return true; // undefined column / access rule
  if (code === "PGRST204" || code === "PGRST202") return true; // unknown column/function
  return false;
}

function preparePayload(entry: OutboxEntry, userId: string): Record<string, unknown> {
  const row = { ...(entry.payload as Record<string, unknown>) };
  if (entry.entity === "profile") {
    // The local profile row uses the literal id "local"; the server PK is the
    // auth user id.
    row.id = userId;
    // The avatar is a device-local data URL blob — never push it.
    delete row.avatar_data;
  }
  if (entry.entity === "product") {
    // Photos are stored locally as data URLs; the server column is a Storage
    // key (`image_path`) that isn't wired up yet. Never push the blobs.
    delete row.image_data;
    delete row.images;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Push (flush outbox)
// ---------------------------------------------------------------------------

let flushing = false;

export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  if (!isCloudEnabled || flushing) return { sent: 0, failed: 0 };
  const supabase = getSupabase();
  if (!supabase) return { sent: 0, failed: 0 };
  if ((await checkOwnerBinding()) !== "ok") return { sent: 0, failed: 0 };
  const userId = (await getSessionUserId())!;

  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const entries = await db.outbox.orderBy("seq").toArray();
    for (const entry of entries) {
      if (entry.permanent) continue; // server rejected for good — needs manual attention
      const table = ENTITY_TABLE[entry.entity];
      try {
        if (entry.op === "delete") {
          const id = (entry.payload as { id: string }).id;
          const { error } = await supabase.from(table).delete().eq("id", id);
          if (error) throw error;
        } else {
          const row = preparePayload(entry, userId);
          let error;
          if (entry.entity === "movement") {
            // Append-only ledger: duplicates must be IGNORED, not updated —
            // conflict target is the (owner_id, client_id) idempotency index.
            ({ error } = await supabase
              .from(table)
              .upsert(row, { onConflict: "owner_id,client_id", ignoreDuplicates: true }));
          } else if (entry.entity === "payment") {
            // Payments are append-only too; a resend must not re-fire triggers.
            ({ error } = await supabase
              .from(table)
              .upsert(row, { onConflict: "id", ignoreDuplicates: true }));
          } else {
            ({ error } = await supabase.from(table).upsert(row));
          }
          if (error) throw error;
        }
        await db.outbox.delete(entry.id);
        sent++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        if (isPermanentError(err)) {
          // Will never succeed — flag it, surface it, and let the rest flush.
          await db.outbox.update(entry.id, {
            attempts: (entry.attempts ?? 0) + 1,
            last_error: message,
            permanent: true,
          });
        } else {
          // Transient (network, 5xx, expired token): keep strict FIFO — stop
          // here so later entries can't apply out of order.
          await db.outbox.update(entry.id, {
            attempts: (entry.attempts ?? 0) + 1,
            last_error: message,
          });
          break;
        }
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

/** Clear permanent flags (after the user fixed the cause) and reflush. */
export async function retryFailedEntries(): Promise<void> {
  const dead = await db.outbox.filter((e) => Boolean(e.permanent)).toArray();
  for (const e of dead) {
    await db.outbox.update(e.id, { permanent: false, last_error: undefined });
  }
  await syncNow();
}

/** Drop permanently-failed entries the user has chosen to discard. */
export async function discardFailedEntries(): Promise<number> {
  const dead = await db.outbox.filter((e) => Boolean(e.permanent)).toArray();
  await db.outbox.bulkDelete(dead.map((e) => e.id));
  return dead.length;
}

// ---------------------------------------------------------------------------
// Pull (delta reads)
// ---------------------------------------------------------------------------

interface PullSpec {
  table: string;
  store: string; // Dexie table name
  tsColumn: "updated_at" | "created_at";
}

const PULL_SPECS: PullSpec[] = [
  { table: "profiles", store: "profiles", tsColumn: "updated_at" },
  { table: "categories", store: "categories", tsColumn: "updated_at" },
  { table: "suppliers", store: "suppliers", tsColumn: "updated_at" },
  { table: "customers", store: "customers", tsColumn: "updated_at" },
  { table: "products", store: "products", tsColumn: "updated_at" },
  { table: "stock_movements", store: "movements", tsColumn: "created_at" },
  { table: "stock_counts", store: "stockCounts", tsColumn: "updated_at" },
  { table: "stock_count_items", store: "stockCountItems", tsColumn: "updated_at" },
  { table: "orders", store: "orders", tsColumn: "updated_at" },
  { table: "order_items", store: "orderItems", tsColumn: "updated_at" },
  { table: "invoices", store: "invoices", tsColumn: "updated_at" },
  { table: "payments", store: "payments", tsColumn: "created_at" },
];

/** Row ids with local changes still waiting to flush — local wins for those. */
async function pendingRowIds(): Promise<Set<string>> {
  const entries = await db.outbox.toArray();
  const ids = new Set<string>();
  for (const e of entries) {
    const id = (e.payload as { id?: string } | null)?.id;
    if (id) ids.add(id);
  }
  return ids;
}

function toLocalRow(spec: PullSpec, server: Record<string, unknown>): Record<string, unknown> {
  const row = { ...server };
  delete row.owner_id;
  if (spec.table === "profiles") row.id = PROFILE_ID;
  if (spec.table === "products") delete row.image_path; // local photos live in image_data
  return row;
}

export async function pullDeltas(): Promise<number> {
  if (!isCloudEnabled) return 0;
  const supabase = getSupabase();
  if (!supabase) return 0;
  if ((await checkOwnerBinding()) !== "ok") return 0;

  const pending = await pendingRowIds();
  let applied = 0;

  for (const spec of PULL_SPECS) {
    const sinceKey = `last_pull:${spec.table}`;
    const since = (await getMeta(sinceKey)) ?? "1970-01-01T00:00:00Z";
    const { data, error } = await supabase
      .from(spec.table)
      .select("*")
      .gt(spec.tsColumn, since)
      .order(spec.tsColumn, { ascending: true })
      .limit(1000);
    if (error || !data || data.length === 0) continue;

    let maxTs = since;
    for (const server of data as Record<string, unknown>[]) {
      const ts = String(server[spec.tsColumn] ?? "");
      if (ts > maxTs) maxTs = ts;
      const row = toLocalRow(spec, server);
      const id = String(row.id);
      if (pending.has(id)) continue; // unsynced local edit wins
      const table = db.table(spec.store);
      const local = (await table.get(id)) as Record<string, unknown> | undefined;
      if (local && spec.tsColumn === "created_at") continue; // append-only rows never change
      if (local && spec.tsColumn === "updated_at") {
        const localTs = String(local.updated_at ?? "");
        if (localTs >= ts) continue; // last-write-wins
      }
      if (spec.table === "products") {
        // Keep the device-local photos across pulls.
        if (local?.image_data) row.image_data = local.image_data;
        if (local?.images) row.images = local.images;
      }
      if (spec.table === "profiles" && local?.avatar_data) {
        row.avatar_data = local.avatar_data; // avatar is device-local
      }
      await table.put(row);
      applied++;
    }
    await setMeta(sinceKey, maxTs);
  }

  if (applied > 0) await bumpCountersFromData();
  return applied;
}

/**
 * After a pull, make sure ORD-/INV- numbering continues past anything already
 * in the cloud so a restored device can't allocate colliding numbers.
 */
async function bumpCountersFromData(): Promise<void> {
  const maxSuffix = (values: (string | undefined)[]): number => {
    let max = 0;
    for (const v of values) {
      const n = Number(v?.split("-").pop());
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  };
  const orders = await db.orders.toArray();
  const invoices = await db.invoices.toArray();
  const bump = async (id: Counter["id"], floor: number) => {
    if (floor <= 0) return;
    const current = (await db.counters.get(id))?.next ?? 1;
    if (floor + 1 > current) await db.counters.put({ id, next: floor + 1 });
  };
  await bump("order", maxSuffix(orders.map((o) => o.order_no)));
  await bump("invoice", maxSuffix(invoices.map((i) => i.invoice_no)));
}

// ---------------------------------------------------------------------------
// Combined sync + status
// ---------------------------------------------------------------------------

let syncing = false;

export async function syncNow(): Promise<{ sent: number; pulled: number }> {
  if (syncing) return { sent: 0, pulled: 0 };
  syncing = true;
  try {
    const { sent } = await flushOutbox();
    const pulled = await pullDeltas();
    if ((await checkOwnerBinding()) === "ok") await setMeta(LAST_SYNC_KEY, nowIso());
    return { sent, pulled };
  } finally {
    syncing = false;
  }
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}
