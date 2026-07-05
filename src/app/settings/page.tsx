"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, PageHeader, Skeleton } from "@/components/ui";
import { InstallApp } from "@/components/InstallApp";
import { useToast } from "@/components/Toast";
import { useOutboxStatus, useProfile } from "@/lib/hooks";
import { useSession } from "@/lib/auth";
import { isCloudEnabled } from "@/lib/supabase";
import { discardFailedEntries, OWNER_KEY, retryFailedEntries, syncNow } from "@/lib/sync";
import { getMeta } from "@/lib/db";
import { downloadBackup, importBackup } from "@/lib/backup";
import { isDatabaseEmpty, resetDatabase, seedPricelistData } from "@/lib/seed";

export default function SettingsPage() {
  const profile = useProfile();
  const status = useOutboxStatus();
  const session = useSession();
  const boundOwner = useLiveQuery(async () => (await getMeta(OWNER_KEY)) ?? null, []);
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  if (!profile) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const ownerMismatch = Boolean(
    session.session && boundOwner && session.session.user.id !== boundOwner
  );

  async function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!confirm("Restoring replaces ALL current local data with the backup. Continue?")) return;
    try {
      await importBackup(await file.text());
      toast("Backup restored", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to restore backup", "error");
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="space-y-4 px-4 pb-8">
        <Card>
          <h2 className="mb-2 font-semibold">Account & business</h2>
          <nav className="divide-y divide-border">
            <NavLink href="/settings/profile" label="Profile settings" />
            <NavLink href="/settings/business" label="Business settings" />
          </nav>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Manage</h2>
          <nav className="divide-y divide-border">
            <NavLink href="/orders" label="Orders" />
            <NavLink href="/customers" label="Customers" />
            <NavLink href="/invoices" label="Invoices" />
            <NavLink href="/movements" label="Activity" />
            <NavLink href="/reports" label="Reports & export" />
            <NavLink href="/stocktake" label="Stocktake" />
            <NavLink href="/settings/categories" label="Categories" />
            <NavLink href="/settings/suppliers" label="Suppliers" />
          </nav>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Sync</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Cloud sync</span>
            <span className={isCloudEnabled ? (session.session ? "text-success" : "text-warning") : "text-muted"}>
              {!isCloudEnabled ? "Local only" : session.session ? "Signed in" : "Signed out"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted">Pending changes</span>
            <span className="text-text">{status?.pending ?? 0}</span>
          </div>
          {ownerMismatch && (
            <div className="mt-3 rounded-xl bg-danger/10 p-3 text-xs text-danger ring-1 ring-danger/20">
              This device&apos;s data belongs to a different account. Sync is paused — reset all data
              below to start fresh with this account.
            </div>
          )}
          {status && status.failed > 0 && (
            <div className="mt-3 space-y-2 rounded-xl bg-danger/10 p-3 ring-1 ring-danger/20">
              <p className="text-xs text-danger">
                {status.failed} change{status.failed === 1 ? "" : "s"} were rejected by the server
                {status.lastError ? `: ${status.lastError}` : "."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  className="h-9"
                  onClick={async () => {
                    await retryFailedEntries();
                    toast("Retrying failed changes", "info");
                  }}
                >
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  className="h-9 text-danger"
                  onClick={async () => {
                    if (!confirm("Discard the failed changes? They will never reach the cloud.")) return;
                    const n = await discardFailedEntries();
                    toast(`Discarded ${n} failed change${n === 1 ? "" : "s"}`, "info");
                  }}
                >
                  Discard
                </Button>
              </div>
            </div>
          )}
          {isCloudEnabled && session.session && !ownerMismatch && (
            <Button
              variant="secondary"
              className="mt-3 h-10 w-full"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  const { sent, pulled } = await syncNow();
                  toast(`Synced — ${sent} pushed, ${pulled} pulled`, "success");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Sync failed", "error");
                } finally {
                  setSyncing(false);
                }
              }}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
          {!isCloudEnabled && (
            <p className="mt-2 text-xs text-muted">
              Add Supabase keys to <span className="font-mono">.env.local</span> to enable cloud backup &amp; multi-device sync.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Install app</h2>
          <p className="mb-3 text-xs text-muted">
            Install StockDesk on your home screen for full-screen, offline use.
          </p>
          <InstallApp />
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Data</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => downloadBackup().catch(() => toast("Backup failed", "error"))}>
              Download backup
            </Button>
            <Button variant="secondary" onClick={() => restoreRef.current?.click()}>
              Restore backup
            </Button>
            <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={onRestoreFile} />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  if (await isDatabaseEmpty()) {
                    await seedPricelistData();
                    toast("Product catalog loaded", "success");
                  } else {
                    toast("Database already has data", "info");
                  }
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Failed to load catalog", "error");
                }
              }}
            >
              Load product catalog
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirm("Delete ALL local data — products, orders, invoices, history, settings? This cannot be undone.")) {
                  await resetDatabase();
                  toast("All data cleared", "success");
                }
              }}
            >
              Reset all data
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Backups include every product, movement, order, invoice and setting on this device.
          </p>
        </Card>

        <p className="pt-2 text-center text-xs text-muted">StockDesk v0.1</p>
      </div>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center justify-between py-3 text-sm">
      <span>{label}</span>
      <span className="text-muted">›</span>
    </Link>
  );
}
