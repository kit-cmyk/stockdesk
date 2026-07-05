// Full local backup/restore. For a local-first IndexedDB app, clearing browser
// storage destroys everything — this gives the user a restorable file (SSOT §8
// screen 14 "export/backup", §10 "data export").

import { db, ensureProfile } from "./db";
import { nowIso } from "./utils";

const BACKUP_VERSION = 1;

const TABLES = [
  "profiles",
  "products",
  "movements",
  "categories",
  "suppliers",
  "customers",
  "orders",
  "orderItems",
  "invoices",
  "payments",
  "counters",
  "stockCounts",
  "stockCountItems",
] as const;

export interface BackupFile {
  app: "stockdesk";
  version: number;
  exported_at: string;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    tables[t] = await db.table(t).toArray();
  }
  return { app: "stockdesk", version: BACKUP_VERSION, exported_at: nowIso(), tables };
}

/** Serialize and hand the backup to the browser as a download. */
export async function downloadBackup(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stockdesk-backup-${backup.exported_at.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Restore a backup file, REPLACING all current local data. The sync outbox and
 * pull bookkeeping are cleared: restored data is treated as the new local
 * truth (it will re-push on the next sync if cloud is enabled).
 */
export async function importBackup(raw: string): Promise<void> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON");
  }
  if (parsed?.app !== "stockdesk" || typeof parsed.version !== "number" || !parsed.tables) {
    throw new Error("That file doesn't look like a StockDesk backup");
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error("This backup was made by a newer version of StockDesk");
  }

  const stores = [...TABLES.map((t) => db.table(t)), db.outbox, db.meta];
  await db.transaction("rw", stores, async () => {
    await Promise.all(stores.map((s) => s.clear()));
    for (const t of TABLES) {
      const rows = parsed.tables[t];
      if (Array.isArray(rows) && rows.length > 0) {
        await db.table(t).bulkPut(rows);
      }
    }
  });
  await ensureProfile();
}
