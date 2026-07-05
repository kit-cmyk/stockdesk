"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, FilterBar, FilterSelect, ListSkeleton, PageHeader } from "@/components/ui";
import { useCustomers, useMovements, usePendingRowIds, useProducts, useProfile } from "@/lib/hooks";
import { movementNetRevenue, movementProfit } from "@/lib/inventory";
import { isCloudEnabled } from "@/lib/supabase";
import { formatDateTime, formatMoney } from "@/lib/utils";
import type { MovementType } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  all: "All types",
  sale: "Sales",
  purchase: "Purchases",
  adjustment: "Adjustments",
  loss: "Losses",
  return_in: "Returns in",
  return_out: "Returns out",
};

const PAGE = 100;

/** End-of-day ISO bound so a "to" date includes the whole selected day. */
function endOfDayIso(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T23:59:59.999`).toISOString();
}
function startOfDayIso(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T00:00:00`).toISOString();
}

export default function MovementsPage() {
  const profile = useProfile();
  const products = useProducts({ includeArchived: true });
  const customers = useCustomers();
  const pendingIds = usePendingRowIds();
  const [type, setType] = useState<string>("all");
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const movements = useMovements({
    type: type as MovementType | "all",
    productId: productId || undefined,
    customerId: customerId || undefined,
    from: startOfDayIso(from),
    to: endOfDayIso(to),
    limit: limit + 1, // +1 to know whether more rows exist
  });

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    products?.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [products]);

  if (!profile || !movements) {
    return (
      <div>
        <PageHeader title="Activity" />
        <ListSkeleton />
      </div>
    );
  }

  const hasMore = movements.length > limit;
  const rows = hasMore ? movements.slice(0, limit) : movements;

  return (
    <div>
      <PageHeader title="Activity" subtitle={`${rows.length}${hasMore ? "+" : ""} movements`} />
      <FilterBar>
        <FilterSelect value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Filter by product">
          <option value="">All products</option>
          {products?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Filter by customer">
          <option value="">All customers</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="h-11 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="h-11 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
      </FilterBar>

      <div className="mt-3 space-y-2 px-4 pb-8">
        {rows.length === 0 ? (
          <EmptyState title="No activity" body="Stock movements will appear here as you receive and sell." />
        ) : (
          rows.map((m) => {
            const profit = movementProfit(m);
            const net = movementNetRevenue(m);
            const pending = isCloudEnabled && pendingIds?.has(m.id);
            return (
              <Link
                key={m.id}
                href={`/products/${m.product_id}`}
                className="flex items-center justify-between rounded-2xl bg-surface p-3 ring-1 ring-border"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {productName.get(m.product_id) ?? "Unknown product"}
                    </span>
                    {pending && <Badge tone="primary">pending</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {TYPE_LABELS[m.type] ?? m.type} · {formatDateTime(m.occurred_at)}
                    {m.reference ? ` · ${m.reference}` : ""}
                  </div>
                  {m.type === "sale" && (
                    <div className="text-xs text-muted">
                      net {formatMoney(net, profile.currency)}
                      {m.tax_amount ? ` · ${profile.tax_label} ${formatMoney(m.tax_amount, profile.currency)}` : ""}
                    </div>
                  )}
                  {m.type === "purchase" && m.unit_cost != null && (
                    <div className="text-xs text-muted">
                      cost {formatMoney(Math.abs(m.quantity_delta) * m.unit_cost, profile.currency)}
                      {m.tax_amount ? ` · input ${profile.tax_label} ${formatMoney(m.tax_amount, profile.currency)}` : ""}
                    </div>
                  )}
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      m.quantity_delta >= 0 ? "text-success" : "text-text"
                    }`}
                  >
                    {m.quantity_delta >= 0 ? "+" : ""}
                    {m.quantity_delta}
                  </div>
                  {m.type === "sale" && (
                    <div className={`text-xs ${profit >= 0 ? "text-success" : "text-danger"}`}>
                      {formatMoney(profit, profile.currency)}
                    </div>
                  )}
                </div>
              </Link>
            );
          })
        )}
        {hasMore && (
          <Button variant="secondary" className="w-full" onClick={() => setLimit((n) => n + PAGE)}>
            Load older movements
          </Button>
        )}
      </div>
    </div>
  );
}
