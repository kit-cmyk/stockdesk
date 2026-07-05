"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { LineChart } from "@/components/Charts";
import { useCustomers, useHomeData, useMovements, useProducts, useProfile } from "@/lib/hooks";
import { movementProfit } from "@/lib/inventory";
import { getMeta, setMeta } from "@/lib/db";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { isDatabaseEmpty, seedPricelistData } from "@/lib/seed";
import { useEffect, useMemo, useState } from "react";
import type { Order, StockMovement } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const profile = useProfile();
  const products = useProducts();
  const home = useHomeData(profile);
  const customers = useCustomers();
  const recent = useMovements(6);
  const toast = useToast();
  const [seeding, setSeeding] = useState(false);
  const onboarded = useLiveQuery(async () => (await getMeta("onboarded")) ?? null, []);

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    customers?.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);

  // First run: collect currency / tax / business name before any data exists
  // (SSOT journey 1). Devices that already have data skip it silently.
  useEffect(() => {
    if (onboarded !== null || !products) return;
    if (products.length === 0) router.replace("/welcome");
    else void setMeta("onboarded", "1");
  }, [onboarded, products, router]);

  if (!profile || !products || !home) return <Skeleton />;

  const monthLabel = new Date().toLocaleString(undefined, { month: "long" });
  const hasMonthSales = home.monthNet !== 0 || home.monthDaily.some((v) => v !== 0);

  async function seed() {
    setSeeding(true);
    try {
      if (await isDatabaseEmpty()) {
        await seedPricelistData();
        toast("Product catalog loaded", "success");
      }
    } finally {
      setSeeding(false);
    }
  }

  if (products.length === 0) {
    return (
      <div>
        <PageHeader title="StockDesk" subtitle={profile.display_name} />
        <div className="px-4">
          <EmptyState
            title="Welcome to StockDesk"
            body="Start by adding your first product, scanning a barcode, or load the product catalog from the supplier pricelist."
            action={
              <div className="flex flex-col gap-2">
                <LinkButton href="/products/new">Add a product</LinkButton>
                <Button variant="secondary" onClick={seed} disabled={seeding}>
                  {seeding ? "Loading…" : "Load product catalog"}
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="StockDesk"
        subtitle={profile.display_name}
        action={<LinkButton href="/orders/new" className="h-10 px-3">+ New order</LinkButton>}
      />

      <div className="space-y-4 px-4 pb-4">
        {/* Hero — total sales this month */}
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-medium text-muted">Sales this month</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-text">
                {formatMoney(home.monthNet, profile.currency)}
              </div>
              <div className="mt-1 text-xs text-muted">
                {monthLabel} · {home.monthUnits} units · {home.monthOrders}{" "}
                {home.monthOrders === 1 ? "order" : "orders"}
              </div>
            </div>
            <Link href="/reports" className="shrink-0 text-sm text-primary">
              Reports
            </Link>
          </div>
          {hasMonthSales && (
            <div className="mt-3">
              <LineChart
                data={home.monthDaily.map((v, i) => ({ label: String(i + 1), value: v }))}
                format={(n) => formatMoney(n, profile.currency)}
              />
            </div>
          )}
        </Card>

        {/* SSOT KPIs: stock value + today/7d/30d revenue & profit + tax */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Stock value"
            value={formatMoney(home.stockValue, profile.currency)}
            sub={`${home.skuCount} products`}
          />
          <Stat
            label="Today"
            value={formatMoney(home.todayNet, profile.currency)}
            sub={`${formatMoney(home.todayProfit, profile.currency)} profit`}
            tone={home.todayProfit > 0 ? "success" : undefined}
          />
          <Stat
            label="Last 7 days"
            value={formatMoney(home.net7d, profile.currency)}
            sub={`${formatMoney(home.profit7d, profile.currency)} profit`}
          />
          <Stat
            label="Last 30 days"
            value={formatMoney(home.net30d, profile.currency)}
            sub={`${formatMoney(home.profit30d, profile.currency)} profit · ${formatMoney(home.tax30d, profile.currency)} ${profile.tax_label}`}
          />
        </div>

        {/* Highlight tiles */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <HighlightCard
            href="/orders"
            label="Pending orders"
            value={String(home.pendingOrders.length)}
            sub={
              home.pendingOrders.length
                ? `${formatMoney(home.pendingOrdersValue, profile.currency)} in drafts`
                : "no open drafts"
            }
            tone={home.pendingOrders.length ? "primary" : "neutral"}
            icon={<CartIcon />}
          />
          <HighlightCard
            href="/products?filter=low"
            label="Low stock items"
            value={String(home.lowStock.length)}
            sub={home.lowStock.length ? "needs reorder" : "all healthy"}
            tone={home.lowStock.length ? "warning" : "success"}
            icon={<AlertIcon />}
          />
          <HighlightCard
            href="/invoices"
            label="Customers owing"
            value={String(home.receivables.length)}
            sub={
              home.receivablesTotal
                ? `${formatMoney(home.receivablesTotal, profile.currency)} outstanding`
                : "nothing due"
            }
            tone={home.receivables.some((r) => r.overdue) ? "danger" : home.receivables.length ? "warning" : "success"}
            icon={<InvoiceIcon />}
          />
        </div>

        {/* Detail lists */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Pending orders */}
          <Card>
            <SectionHead title="Pending orders" count={home.pendingOrders.length} href="/orders" />
            {home.pendingOrders.length > 0 ? (
              <ul className="space-y-2">
                {home.pendingOrders.slice(0, 5).map((o: Order) => (
                  <li key={o.id}>
                    <Link
                      href={`/orders/${o.id}`}
                      className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{o.order_no}</div>
                        <div className="text-xs text-muted">
                          {(o.customer_id && customerName.get(o.customer_id)) || "Walk-in"}
                        </div>
                      </div>
                      <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums">
                        {formatMoney(o.total, profile.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>No drafts. <Link href="/orders/new" className="text-primary">Start an order</Link>.</EmptyHint>
            )}
          </Card>

          {/* Low stock */}
          <Card>
            <SectionHead title="Reorder soon" count={home.lowStock.length} href="/products?filter=low" tone="warning" />
            {home.lowStock.length > 0 ? (
              <ul className="space-y-2">
                {home.lowStock.slice(0, 5).map((p) => {
                  const threshold = p.reorder_point ?? profile.low_stock_default;
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/products/${p.id}`}
                        className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          {p.reorder_qty ? (
                            <div className="text-xs text-muted">order {p.reorder_qty} {p.unit}</div>
                          ) : null}
                        </div>
                        <span className={`ml-2 shrink-0 text-sm ${p.quantity_on_hand < 0 ? "text-danger" : "text-warning"}`}>
                          {p.quantity_on_hand}/{threshold} {p.unit}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyHint>All products are above their reorder point.</EmptyHint>
            )}
          </Card>

          {/* Customers with pending invoices */}
          <Card>
            <SectionHead
              title="Customers owing"
              count={home.receivables.length}
              href="/invoices"
              tone="warning"
            />
            {home.receivables.length > 0 ? (
              <ul className="space-y-2">
                {home.receivables.slice(0, 5).map((r) => (
                  <li key={r.customerId ?? "walkin"}>
                    <Link
                      href={r.customerId ? `/customers/${r.customerId}` : "/invoices"}
                      className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{r.name}</span>
                          {r.overdue && <Badge tone="danger">overdue</Badge>}
                        </div>
                        <div className="text-xs text-muted">
                          {r.invoiceCount} {r.invoiceCount === 1 ? "invoice" : "invoices"}
                        </div>
                      </div>
                      <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums text-warning">
                        {formatMoney(r.balance, profile.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>No outstanding invoices.</EmptyHint>
            )}
          </Card>

          {/* Top sellers (30d, by profit) */}
          <Card>
            <SectionHead title="Top sellers · 30d" href="/reports" linkLabel="Reports" />
            {home.topSellers.length > 0 ? (
              <ul className="space-y-2">
                {home.topSellers.map((t) => (
                  <li key={t.product.id}>
                    <Link
                      href={`/products/${t.product.id}`}
                      className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.product.name}</div>
                        <div className="text-xs text-muted">{t.units} sold</div>
                      </div>
                      <span className={`ml-2 shrink-0 text-sm font-semibold tabular-nums ${t.profit >= 0 ? "text-success" : "text-danger"}`}>
                        {formatMoney(t.profit, profile.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>No sales in the last 30 days.</EmptyHint>
            )}
          </Card>

          {/* Recent activity */}
          <Card>
            <SectionHead title="Recent activity" href="/movements" linkLabel="View all" />
            {recent && recent.length > 0 ? (
              <ul className="space-y-1">
                {recent.map((m) => (
                  <RecentRow key={m.id} m={m} products={products} currency={profile.currency} />
                ))}
              </ul>
            ) : (
              <EmptyHint>No movements yet.</EmptyHint>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

const TONE_VALUE: Record<Tone, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-text",
};
const TONE_ICON: Record<Tone, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-surface-2 text-muted",
};

function HighlightCard({
  href,
  label,
  value,
  sub,
  tone,
  icon,
}: {
  href: string;
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:ring-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
          {icon}
        </span>
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${TONE_VALUE[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Link>
  );
}

function SectionHead({
  title,
  count,
  href,
  linkLabel,
  tone = "neutral",
}: {
  title: string;
  count?: number;
  href: string;
  linkLabel?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-text">{title}</h2>
        {count != null && count > 0 && (
          <Badge tone={tone === "warning" ? "warning" : "neutral"}>{count}</Badge>
        )}
      </div>
      <Link href={href} className="text-sm text-primary">
        {linkLabel ?? "View all"}
      </Link>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted">{children}</p>;
}

function RecentRow({
  m,
  products,
  currency,
}: {
  m: StockMovement;
  products: { id: string; name: string }[];
  currency: string;
}) {
  const name = products.find((p) => p.id === m.product_id)?.name ?? "Unknown";
  const profit = movementProfit(m);
  return (
    <li className="flex items-center justify-between py-1.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="text-xs text-muted">
          {labelFor(m.type)} · {formatDateTime(m.occurred_at)}
        </div>
      </div>
      <div className="ml-2 shrink-0 text-right">
        <div className={`text-sm font-semibold tabular-nums ${m.quantity_delta >= 0 ? "text-success" : "text-text"}`}>
          {m.quantity_delta >= 0 ? "+" : ""}
          {m.quantity_delta}
        </div>
        {m.type === "sale" && <div className="text-xs text-success">{formatMoney(profit, currency)}</div>}
      </div>
    </li>
  );
}

function labelFor(type: string) {
  return (
    {
      purchase: "Received",
      sale: "Sold",
      adjustment: "Adjusted",
      loss: "Loss",
      return_in: "Return in",
      return_out: "Return out",
      opening: "Opening",
    } as Record<string, string>
  )[type] ?? type;
}

function CartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.4 12.4a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L21 7H6" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
function InvoiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className="px-4 pt-6">
      <div className="h-8 w-40 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 h-32 animate-pulse rounded-2xl bg-surface" />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface" />
        ))}
      </div>
    </div>
  );
}
