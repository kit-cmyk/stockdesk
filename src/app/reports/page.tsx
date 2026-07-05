"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, FilterSelect, PageHeader, Stat, ListSkeleton } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { BarList, LineChart } from "@/components/Charts";
import { useAllMovements, useProducts, useProfile } from "@/lib/hooks";
import {
  isLowStock,
  movementCogs,
  movementNetRevenue,
  movementProfit,
  stockValue,
} from "@/lib/inventory";
import {
  dailySalesSeries,
  inventoryTurnover,
  inventoryValueSeries,
  productMetrics,
} from "@/lib/metrics";
import { daysAgoIso, formatMoney } from "@/lib/utils";

export default function ReportsPage() {
  const profile = useProfile();
  const products = useProducts({ includeArchived: true });
  const movements = useAllMovements();
  const toast = useToast();
  const [days, setDays] = useState(30);

  const data = useMemo(() => {
    if (!products || !movements || !profile) return null;
    const since = daysAgoIso(days);
    const sales = movements.filter((m) => m.type === "sale" && m.occurred_at >= since);
    const purchases = movements.filter((m) => m.type === "purchase" && m.occurred_at >= since);
    const active = products.filter((p) => !p.is_archived);

    const perProduct = active
      .map((p) => ({ p, m: productMetrics(p, movements, days) }))
      .filter((x) => x.m.unitsSold > 0)
      .sort((a, b) => b.m.profit - a.m.profit);

    const outputTax = sales.reduce((s, m) => s + (m.tax_amount ?? 0), 0);
    const inputTax = purchases.reduce((s, m) => s + (m.tax_amount ?? 0), 0);

    const reorder = active
      .map((p) => ({ p, m: productMetrics(p, movements, days) }))
      .filter((x) => x.m.reorderSuggestion > 0 || isLowStock(x.p, profile))
      .sort((a, b) => b.m.reorderSuggestion - a.m.reorderSuggestion);

    return {
      revenue: sales.reduce((s, m) => s + movementNetRevenue(m), 0),
      cogs: sales.reduce((s, m) => s + movementCogs(m), 0),
      profit: sales.reduce((s, m) => s + movementProfit(m), 0),
      outputTax,
      inputTax,
      netTax: outputTax - inputTax,
      perProduct,
      reorder,
      stockValue: active.reduce((s, p) => s + stockValue(p), 0),
      turnover: inventoryTurnover(movements, products, profile, days),
      salesSeries: dailySalesSeries(sales, days),
      valueSeries: inventoryValueSeries(movements, products, profile, days),
    };
  }, [products, movements, days, profile]);

  if (!profile || !data) {
    return (
      <div>
        <PageHeader title="Reports" />
        <ListSkeleton rows={4} />
      </div>
    );
  }

  const fmt = (n: number) => formatMoney(n, profile.currency);

  function exportCsv() {
    if (!movements || !products) return;
    const name = new Map(products.map((p) => [p.id, p.name]));
    const header = ["date", "product", "type", "qty", "unit_price", "unit_cost", "tax", "net_revenue", "cogs", "profit"];
    const rows = movements.map((m) => [
      m.occurred_at,
      JSON.stringify(name.get(m.product_id) ?? ""),
      m.type,
      m.quantity_delta,
      m.unit_price ?? "",
      m.unit_cost ?? "",
      m.tax_amount ?? "",
      movementNetRevenue(m),
      movementCogs(m),
      movementProfit(m),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stockdesk-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported", "success");
  }

  return (
    <div>
      <PageHeader title="Reports" />
      <div className="space-y-4 px-4 pb-8">
        <div className="flex justify-end">
          <FilterSelect
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Reporting period"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </FilterSelect>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Net revenue" value={fmt(data.revenue)} />
          <Stat label="Profit" value={fmt(data.profit)} tone="success" />
          <Stat label="Stock value" value={fmt(data.stockValue)} />
          <Stat label="Turnover" value={`${data.turnover}×`} sub={`over ${days}d`} />
        </div>

        <Card>
          <h2 className="mb-2 font-semibold">Profit trend</h2>
          <LineChart
            data={data.salesSeries.map((d) => ({ label: shortDate(d.date), value: d.profit }))}
            format={fmt}
          />
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Inventory value</h2>
          <LineChart
            data={data.valueSeries.map((d) => ({ label: shortDate(d.date), value: d.value }))}
            stroke="var(--color-success)"
            fill="var(--color-success)"
            format={fmt}
          />
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{profile.tax_label} summary</h2>
          <Line label={`Output ${profile.tax_label} (collected)`} value={fmt(data.outputTax)} />
          <Line label={`Input ${profile.tax_label} (paid)`} value={fmt(data.inputTax)} />
          <div className="my-2 border-t border-border" />
          <Line label="Net liability" value={fmt(data.netTax)} strong />
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Top products by profit</h2>
          {data.perProduct.length === 0 ? (
            <p className="text-sm text-muted">No sales in this period.</p>
          ) : (
            <BarList
              items={data.perProduct.slice(0, 8).map((x) => ({
                label: x.p.name,
                value: x.m.profit,
                sub: `${x.m.unitsSold} sold · ${x.m.sellThroughPct}% sell-through`,
              }))}
              format={fmt}
            />
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Reorder suggestions</h2>
          {data.reorder.length === 0 ? (
            <p className="text-sm text-muted">Nothing needs reordering right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.reorder.slice(0, 12).map((x) => (
                <li key={x.p.id}>
                  <Link
                    href={`/products/${x.p.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{x.p.name}</div>
                      <div className="text-xs text-muted">
                        {x.p.quantity_on_hand} on hand
                        {x.m.daysOfInventory != null ? ` · ~${x.m.daysOfInventory}d left` : ""}
                        {x.m.avgDailySales > 0 ? ` · ${x.m.avgDailySales}/day` : ""}
                      </div>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-1 text-right">
                      <span className="text-sm font-semibold text-primary">
                        {x.m.reorderSuggestion > 0 ? `order ${x.m.reorderSuggestion}` : "low"}
                      </span>
                      <span className="text-muted">›</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Button variant="secondary" className="w-full" onClick={exportCsv}>
          Export all movements (CSV)
        </Button>
      </div>
    </div>
  );
}

function shortDate(iso: string) {
  return iso.slice(5); // MM-DD
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className={strong ? "font-bold text-text" : "font-medium text-text"}>{value}</span>
    </div>
  );
}
