"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, DetailSkeleton, Stat } from "@/components/ui";
import { CustomerFormSheet } from "@/components/CustomerFormSheet";
import { Sparkline } from "@/components/Charts";
import { useToast } from "@/components/Toast";
import {
  useCustomer,
  useCustomerInvoices,
  useCustomerOrders,
  useCustomerSales,
  useProfile,
} from "@/lib/hooks";
import { customerRollup, isOverdue } from "@/lib/customers";
import { dailySalesSeries } from "@/lib/metrics";
import { movementNetRevenue, movementProfit } from "@/lib/inventory";
import { createDraftOrder } from "@/lib/repo";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";
import { useProducts } from "@/lib/hooks";
import type { Invoice, Order } from "@/lib/types";

const ORDER_TONE: Record<Order["status"], "neutral" | "success" | "danger"> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const profile = useProfile();
  const customer = useCustomer(params.id);
  const sales = useCustomerSales(params.id);
  const invoices = useCustomerInvoices(params.id);
  const orders = useCustomerOrders(params.id);
  const products = useProducts({ includeArchived: true });
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const rollup = useMemo(
    () => (sales && invoices ? customerRollup(sales, invoices) : null),
    [sales, invoices]
  );
  const spark = useMemo(
    () => (sales ? dailySalesSeries(sales, 90).map((d) => d.units) : []),
    [sales]
  );

  const productName = useMemo(() => {
    const m = new Map<string, string>();
    products?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [products]);

  if (!profile || customer === undefined) return <DetailSkeleton />;
  if (customer === null) {
    return (
      <div className="px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Customer not found</h1>
        <p className="mt-1 text-sm text-muted">They may have been deleted or the link is stale.</p>
        <Button className="mt-4" onClick={() => router.push("/customers")}>
          Go to customers
        </Button>
      </div>
    );
  }

  async function newOrder() {
    setBusy(true);
    try {
      const id = await createDraftOrder(params.id);
      router.push(`/orders/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to start order", "error");
      setBusy(false);
    }
  }

  const owed = rollup?.outstandingBalance ?? 0;

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
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-2 text-2xl font-bold text-muted">
          {customer.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{customer.name}</h1>
          {customer.contact && <div className="text-sm text-muted">{customer.contact}</div>}
          {customer.note && <div className="mt-0.5 text-xs text-muted">{customer.note}</div>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Stat label="Lifetime revenue" value={formatMoney(rollup?.lifetimeNetRevenue ?? 0, profile.currency)} />
        <Stat
          label="Lifetime profit"
          value={formatMoney(rollup?.lifetimeProfit ?? 0, profile.currency)}
          tone={(rollup?.lifetimeProfit ?? 0) >= 0 ? "success" : "danger"}
        />
        <Stat label="Orders" value={`${rollup?.orderCount ?? 0}`} sub={`${rollup?.unitsSold ?? 0} units`} />
        <Stat
          label="Balance owed"
          value={formatMoney(owed, profile.currency)}
          tone={owed > 0 ? "warning" : undefined}
        />
      </div>

      {spark.some((v) => v > 0) && (
        <Card className="mt-4">
          <div className="mb-2 text-sm font-semibold">Units sold · 90d</div>
          <Sparkline values={spark} />
        </Card>
      )}

      <Button className="mt-4 w-full" onClick={newOrder} disabled={busy}>
        {busy ? "Starting…" : "+ New order"}
      </Button>

      <Section title="Orders">
        {orders && orders.length > 0 ? (
          <ul className="divide-y divide-border">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{o.order_no}</div>
                    <div className="text-xs text-muted">{formatDate(o.occurred_at)}</div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-2">
                    <Badge tone={ORDER_TONE[o.status]}>{o.status}</Badge>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(o.total, profile.currency)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No orders yet.</p>
        )}
      </Section>

      <Section title="Invoices">
        {invoices && invoices.length > 0 ? (
          <ul className="divide-y divide-border">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link href={`/invoices/${inv.id}`} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{inv.invoice_no}</div>
                    <div className="text-xs text-muted">
                      {formatDate(inv.issued_at)}
                      {isOverdue(inv) ? " · overdue" : ""}
                    </div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-2">
                    <Badge tone={invoiceTone(inv)}>{inv.status}</Badge>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(inv.total, profile.currency)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No invoices yet.</p>
        )}
      </Section>

      <Section title="Sales history">
        {sales && sales.length > 0 ? (
          <ul className="divide-y divide-border">
            {sales.slice(0, 50).map((m) => (
              <li key={m.id}>
                <Link href={`/products/${m.product_id}`} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {productName.get(m.product_id) ?? "Unknown product"}
                    </div>
                    <div className="text-xs text-muted">
                      {formatDateTime(m.occurred_at)}
                      {m.order_id ? ` · ${m.reference ?? "order"}` : " · direct sale"}
                    </div>
                  </div>
                  <div className="ml-2 shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {Math.abs(m.quantity_delta)} × {formatMoney(m.unit_price ?? 0, profile.currency)}
                    </div>
                    <div className={`text-xs ${movementProfit(m) >= 0 ? "text-success" : "text-danger"}`}>
                      {formatMoney(movementNetRevenue(m), profile.currency)} net
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No sales yet.</p>
        )}
      </Section>

      <CustomerFormSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
        onSaved={() => setEditOpen(false)}
      />
    </div>
  );
}

function invoiceTone(inv: Invoice): "neutral" | "success" | "warning" | "danger" {
  if (inv.status === "paid") return "success";
  if (inv.status === "void") return "neutral";
  if (isOverdue(inv)) return "danger";
  return "warning";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mt-5">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </Card>
  );
}
