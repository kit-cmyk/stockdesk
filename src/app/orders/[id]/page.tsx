"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, DetailSkeleton, LinkButton, Stat } from "@/components/ui";
import { OrderCart } from "@/components/OrderCart";
import { useToast } from "@/components/Toast";
import {
  useCustomer,
  useCustomers,
  useInvoiceForOrder,
  useOrder,
  useOrderItems,
  useProducts,
  useProfile,
} from "@/lib/hooks";
import { cancelOrder } from "@/lib/repo";
import { formatDate, formatMoney } from "@/lib/utils";
import type { Order } from "@/lib/types";

const TONE: Record<Order["status"], "neutral" | "success" | "danger"> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const profile = useProfile();
  const order = useOrder(params.id);
  const items = useOrderItems(params.id);
  const products = useProducts({ includeArchived: true });
  const customers = useCustomers();
  const customer = useCustomer(order?.customer_id) ?? undefined;
  const invoice = useInvoiceForOrder(params.id);
  const [busy, setBusy] = useState(false);

  const productName = useMemo(() => {
    const m = new Map<string, string>();
    products?.forEach((p) => m.set(p.id, p.name));
    return (id: string) => m.get(id) ?? "Unknown product";
  }, [products]);

  if (!profile || order === undefined || !items || !products || !customers) {
    return <DetailSkeleton />;
  }
  if (order === null) {
    return (
      <div className="px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Order not found</h1>
        <p className="mt-1 text-sm text-muted">It may have been discarded or the link is stale.</p>
        <Button className="mt-4" onClick={() => router.push("/orders")}>
          Go to orders
        </Button>
      </div>
    );
  }

  // Draft orders use the editable cart.
  if (order.status === "draft") {
    return (
      <OrderCart order={order} items={items} products={products} customers={customers} profile={profile} />
    );
  }

  async function doCancel() {
    if (!confirm("Cancel this order? Stock will be returned and the invoice voided.")) return;
    setBusy(true);
    try {
      await cancelOrder(order!.id);
      toast("Order cancelled", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to cancel", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-8">
      <div className="flex items-center justify-between pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
        <Badge tone={TONE[order.status]}>{order.status}</Badge>
      </div>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">{order.order_no}</h1>
      <p className="text-sm text-muted">
        {formatDate(order.occurred_at)}
        {customer ? ` · ${customer.name}` : " · Walk-in"}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Total" value={formatMoney(order.total, profile.currency)} />
        <Stat label={profile.tax_label} value={formatMoney(order.tax_total, profile.currency)} />
      </div>

      <Card className="mt-4">
        <h2 className="mb-2 font-semibold">Items</h2>
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{productName(it.product_id)}</div>
                <div className="text-xs text-muted">
                  {it.quantity} × {formatMoney(it.unit_price, profile.currency)}
                </div>
              </div>
              <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums">
                {formatMoney(it.quantity * it.unit_price, profile.currency)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {invoice && (
        <LinkButton href={`/invoices/${invoice.id}`} className="mt-4 w-full">
          View invoice {invoice.invoice_no}
        </LinkButton>
      )}

      {order.status === "confirmed" && (
        <button
          onClick={doCancel}
          disabled={busy}
          className="mt-4 w-full text-center text-sm text-danger"
        >
          {busy ? "Cancelling…" : "Cancel order & return stock"}
        </button>
      )}
    </div>
  );
}
