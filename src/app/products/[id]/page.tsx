"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, DetailSkeleton, Stat } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { ImageViewer } from "@/components/ImageViewer";
import { MovementForm } from "@/components/MovementForm";
import { ProductFormSheet } from "@/components/ProductFormSheet";
import { Sparkline } from "@/components/Charts";
import { useToast } from "@/components/Toast";
import { useProduct, useProductMovements, useProfile } from "@/lib/hooks";
import { dailySalesSeries, productMetrics } from "@/lib/metrics";
import {
  earningsPerUnit,
  marginPct,
  movementProfit,
  stockFlag,
  stockValue,
} from "@/lib/inventory";
import { archiveProduct } from "@/lib/repo";
import { formatDateTime, formatMoney } from "@/lib/utils";
import type { StockMovement } from "@/lib/types";

type Action = "receive" | "sell" | "adjust" | null;

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const profile = useProfile();
  const product = useProduct(params.id);
  const movements = useProductMovements(params.id);
  const [action, setAction] = useState<Action>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageIdx, setImageIdx] = useState(0);

  // Hooks must all run on every render (before any early return below).
  const metrics = useMemo(
    () => (product && movements ? productMetrics(product, movements, 30) : null),
    [product, movements]
  );
  const spark = useMemo(
    () =>
      product && movements
        ? dailySalesSeries(movements.filter((m) => m.product_id === product.id), 30).map((d) => d.units)
        : [],
    [movements, product]
  );

  if (!profile || product === undefined) return <DetailSkeleton />;
  if (product === null) {
    return (
      <div className="px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Product not found</h1>
        <p className="mt-1 text-sm text-muted">It may have been deleted or the link is stale.</p>
        <Button className="mt-4" onClick={() => router.push("/products")}>
          Go to products
        </Button>
      </div>
    );
  }

  const flag = stockFlag(product, profile);
  const low = flag !== null;
  const margin = marginPct(product, profile);
  const earn = earningsPerUnit(product, profile);
  // All photos; older single-photo products fall back to just the thumbnail.
  const gallery = product.images?.length
    ? product.images
    : product.image_data
      ? [product.image_data]
      : [];

  function openImage(i: number) {
    setImageIdx(i);
    setImageOpen(true);
  }

  async function toggleArchive() {
    await archiveProduct(product!.id, !product!.is_archived);
    toast(product!.is_archived ? "Restored" : "Archived", "success");
    if (!product!.is_archived) router.push("/products");
  }

  return (
    <div className="px-4 pb-8">
      <div className="flex items-center justify-between pb-3 pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
        <Button variant="ghost" className="h-9 px-3" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </div>

      <div className="flex items-center gap-4">
        {product.image_data ? (
          <button
            type="button"
            aria-label="View full image"
            onClick={() => openImage(Math.max(gallery.indexOf(product.image_data!), 0))}
            className="h-16 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={product.image_data} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-2 text-2xl font-bold text-muted">
            {product.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{product.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            {product.sku && <span>SKU {product.sku}</span>}
            {product.barcode && <span>· {product.barcode}</span>}
            {flag === "negative" && <Badge tone="danger">Negative stock — reconcile</Badge>}
            {flag === "low" && <Badge tone="warning">Low stock</Badge>}
          </div>
        </div>
      </div>

      {gallery.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {gallery.map((src, i) => (
            <button
              key={i}
              type="button"
              aria-label={`View photo ${i + 1} of ${gallery.length}`}
              onClick={() => openImage(i)}
              className="h-14 w-14 shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border transition hover:ring-primary/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Stat
          label="On hand"
          value={`${product.quantity_on_hand} ${product.unit}`}
          tone={flag === "negative" ? "danger" : low ? "warning" : undefined}
          sub={flag === "negative" ? "Sold before recording receipt — adjust or receive stock" : undefined}
        />
        <Stat label="Stock value" value={formatMoney(stockValue(product), profile.currency)} />
        <Stat label="Avg cost / unit" value={formatMoney(product.avg_cost, profile.currency)} />
        <Stat
          label="Earnings / unit"
          value={earn != null ? formatMoney(earn, profile.currency) : "—"}
          sub={margin != null ? `${margin}% margin` : undefined}
          tone={earn != null && earn >= 0 ? "success" : earn != null ? "danger" : undefined}
        />
      </div>

      {metrics && (metrics.unitsSold > 0 || product.quantity_on_hand > 0) && (
        <Card className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Performance · 30d</h2>
            <span className="text-xs text-muted">{metrics.unitsSold} sold</span>
          </div>
          <Sparkline values={spark} />
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Mini label="Sell-through" value={`${metrics.sellThroughPct}%`} />
            <Mini label="Per day" value={`${metrics.avgDailySales}`} />
            <Mini
              label="Days left"
              value={metrics.daysOfInventory != null ? `${metrics.daysOfInventory}` : "—"}
            />
          </div>
          {metrics.reorderSuggestion > 0 && (
            <div className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary ring-1 ring-primary/20">
              Suggested reorder: <span className="font-semibold">{metrics.reorderSuggestion} {product.unit}</span>
            </div>
          )}
        </Card>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button onClick={() => setAction("receive")}>Receive</Button>
        <Button onClick={() => setAction("sell")}>Sell</Button>
        <Button variant="secondary" onClick={() => setAction("adjust")}>
          Adjust
        </Button>
      </div>

      <Card className="mt-5">
        <h2 className="mb-3 font-semibold">History</h2>
        {movements && movements.length > 0 ? (
          <ul className="divide-y divide-border">
            {movements.map((m) => (
              <HistoryRow key={m.id} m={m} currency={profile.currency} taxLabel={profile.tax_label} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No movements yet.</p>
        )}
      </Card>

      <button onClick={toggleArchive} className="mt-6 w-full text-center text-sm text-muted">
        {product.is_archived ? "Restore product" : "Archive product"}
      </button>

      <Sheet
        open={action !== null}
        onClose={() => setAction(null)}
        title={action === "receive" ? "Receive stock" : action === "sell" ? "Record sale" : "Adjust stock"}
      >
        {action && (
          <MovementForm mode={action} product={product} profile={profile} onDone={() => setAction(null)} />
        )}
      </Sheet>

      <ProductFormSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        profile={profile}
        product={product}
        onSaved={() => setEditOpen(false)}
      />

      {gallery.length > 0 && (
        <ImageViewer
          images={gallery}
          initialIndex={imageIdx}
          alt={product.name}
          open={imageOpen}
          onClose={() => setImageOpen(false)}
        />
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function HistoryRow({
  m,
  currency,
  taxLabel,
}: {
  m: StockMovement;
  currency: string;
  taxLabel: string;
}) {
  const profit = movementProfit(m);
  return (
    <li className="flex items-center justify-between py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium capitalize">{m.type.replace("_", " ")}</div>
        <div className="text-xs text-muted">
          {formatDateTime(m.occurred_at)}
          {m.unit_price != null && ` · @ ${formatMoney(m.unit_price, currency)}`}
          {m.unit_cost != null && ` · cost ${formatMoney(m.unit_cost, currency)}`}
          {m.tax_amount ? ` · ${taxLabel} ${formatMoney(m.tax_amount, currency)}` : ""}
        </div>
      </div>
      <div className="ml-2 shrink-0 text-right">
        <div className={`text-sm font-semibold tabular-nums ${m.quantity_delta >= 0 ? "text-success" : "text-text"}`}>
          {m.quantity_delta >= 0 ? "+" : ""}
          {m.quantity_delta}
        </div>
        {m.type === "sale" && (
          <div className={`text-xs ${profit >= 0 ? "text-success" : "text-danger"}`}>
            {formatMoney(profit, currency)}
          </div>
        )}
      </div>
    </li>
  );
}
