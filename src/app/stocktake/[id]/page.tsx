"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, DetailSkeleton, Input, Stat } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useCountItems, useProducts, useStockCount } from "@/lib/hooks";
import { commitStockCount, deleteStockCount, setCountItem } from "@/lib/repo";

export default function StockCountPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const count = useStockCount(params.id);
  const items = useCountItems(params.id);
  const products = useProducts({ includeArchived: true });
  const [busy, setBusy] = useState(false);

  const productName = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; onHand: number }>();
    products?.forEach((p) =>
      m.set(p.id, { name: p.name, unit: p.unit, onHand: p.quantity_on_hand })
    );
    return m;
  }, [products]);

  if (count === undefined || items === undefined || !products) {
    return <DetailSkeleton />;
  }
  if (count === null) {
    return (
      <div className="px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Count not found</h1>
        <p className="mt-1 text-sm text-muted">It may have been deleted.</p>
        <Button className="mt-4" onClick={() => router.push("/stocktake")}>
          Go to stocktake
        </Button>
      </div>
    );
  }

  const committed = count.status === "committed";
  const counted = items.filter((i) => i.counted_qty != null).length;
  const variances = items.filter(
    (i) => i.counted_qty != null && i.counted_qty !== (productName.get(i.product_id)?.onHand ?? i.expected_qty)
  );

  async function commit() {
    if (!confirm(`Commit this count? ${variances.length} variance adjustment(s) will be recorded.`)) return;
    setBusy(true);
    try {
      const n = await commitStockCount(params.id);
      toast(`Committed · ${n} adjustment(s) made`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to commit count", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this count session? Counted values will be lost.")) return;
    try {
      await deleteStockCount(params.id);
      router.replace("/stocktake");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete count", "error");
    }
  }

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between px-4 pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
        <Badge tone={committed ? "success" : "primary"}>{committed ? "Committed" : "Open"}</Badge>
      </div>

      <div className="px-4 pb-3 pt-3">
        <h1 className="text-2xl font-bold">{count.note || "Stock count"}</h1>
      </div>

      <div className="grid grid-cols-3 gap-3 px-4">
        <Stat label="Items" value={String(items.length)} />
        <Stat label="Counted" value={`${counted}/${items.length}`} />
        <Stat label="Variances" value={String(variances.length)} tone={variances.length ? "warning" : "success"} />
      </div>

      <div className="mt-4 space-y-2 px-4">
        {items.map((item) => {
          const info = productName.get(item.product_id);
          const onHand = info?.onHand ?? item.expected_qty;
          const variance = item.counted_qty == null ? null : item.counted_qty - onHand;
          return (
            <Card key={item.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{info?.name ?? "Unknown"}</div>
                <div className="text-xs text-muted">
                  System: {onHand} {info?.unit}
                  {variance != null && variance !== 0 && (
                    <span className={variance > 0 ? " text-success" : " text-danger"}>
                      {" "}· {variance > 0 ? "+" : ""}
                      {variance}
                    </span>
                  )}
                </div>
              </div>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                disabled={committed}
                defaultValue={item.counted_qty ?? ""}
                placeholder="count"
                className="h-11 w-24 text-center"
                onBlur={(e) => {
                  // A physical count can never be negative.
                  const v = e.target.value === "" ? null : Math.max(0, Math.trunc(Number(e.target.value)));
                  if (v !== item.counted_qty) {
                    setCountItem(item.id, v).catch((err) =>
                      toast(err instanceof Error ? err.message : "Failed to save count", "error")
                    );
                  }
                }}
              />
            </Card>
          );
        })}
      </div>

      {!committed ? (
        <div className="mt-5 space-y-2 px-4">
          <Button className="w-full" onClick={commit} disabled={busy || counted === 0}>
            {busy ? "Committing…" : `Commit count (${variances.length} adjustment${variances.length === 1 ? "" : "s"})`}
          </Button>
          <button onClick={remove} className="w-full text-center text-sm text-muted">
            Delete count session
          </button>
        </div>
      ) : (
        <p className="mt-5 px-4 text-center text-sm text-muted">
          This count is committed. Variance adjustments are recorded in each product&apos;s history.
        </p>
      )}
    </div>
  );
}
