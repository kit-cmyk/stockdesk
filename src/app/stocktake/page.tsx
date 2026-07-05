"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader, ListSkeleton } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useStockCounts } from "@/lib/hooks";
import { createStockCount } from "@/lib/repo";
import { formatDateTime } from "@/lib/utils";

export default function StocktakePage() {
  const router = useRouter();
  const toast = useToast();
  const counts = useStockCounts();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const id = await createStockCount();
      toast("Count session started", "success");
      router.push(`/stocktake/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to start a count", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center px-4 pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
      </div>
      <PageHeader
        title="Stocktake"
        subtitle="Count physical stock and reconcile variances"
        action={
          <Button className="h-10 px-3" onClick={start} disabled={busy}>
            {busy ? "…" : "+ New count"}
          </Button>
        }
      />
      <div className="space-y-2 px-4">
        {!counts ? (
          <ListSkeleton rows={3} className="px-0" />
        ) : counts.length === 0 ? (
          <EmptyState
            title="No counts yet"
            body="Start a count to verify your on-hand quantities against a physical count."
            action={<Button onClick={start}>Start a count</Button>}
          />
        ) : (
          counts.map((c) => (
            <Link
              key={c.id}
              href={`/stocktake/${c.id}`}
              className="flex items-center justify-between rounded-2xl bg-surface p-4 ring-1 ring-border"
            >
              <div>
                <div className="font-medium">{c.note || "Stock count"}</div>
                <div className="text-xs text-muted">
                  {c.status === "committed" && c.committed_at
                    ? `Committed ${formatDateTime(c.committed_at)}`
                    : `Started ${formatDateTime(c.created_at)}`}
                </div>
              </div>
              <Badge tone={c.status === "committed" ? "success" : "primary"}>
                {c.status === "committed" ? "Committed" : "Open"}
              </Badge>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
