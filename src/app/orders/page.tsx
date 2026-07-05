"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, EmptyState, FilterBar, FilterSelect, LinkButton, PageHeader, ListSkeleton } from "@/components/ui";
import { useCustomers, useOrders, useProfile } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/utils";
import type { Order, OrderStatus } from "@/lib/types";

const TONE: Record<OrderStatus, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

export default function OrdersPage() {
  const profile = useProfile();
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const orders = useOrders(status);
  const customers = useCustomers();

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    customers?.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);

  if (!profile || !orders)
    return (
      <div>
        <PageHeader title="Orders" />
        <ListSkeleton />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
        action={<LinkButton href="/orders/new" className="h-10 px-3">+ New</LinkButton>}
      />

      <FilterBar>
        <FilterSelect
          value={status}
          onChange={(e) => setStatus(e.target.value as OrderStatus | "all")}
          aria-label="Filter by status"
        >
          <option value="all">All orders</option>
          <option value="draft">Drafts</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </FilterSelect>
      </FilterBar>

      <div className="mt-3 space-y-2 px-4">
        {orders.length === 0 ? (
          <EmptyState
            title="No orders"
            body="Create a multi-item order for a customer."
            action={<LinkButton href="/orders/new">New order</LinkButton>}
          />
        ) : (
          orders.map((o: Order) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="flex items-center justify-between rounded-2xl bg-surface p-3 ring-1 ring-border"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{o.order_no}</span>
                  <Badge tone={TONE[o.status]}>{o.status}</Badge>
                </div>
                <div className="text-xs text-muted">
                  {(o.customer_id && customerName.get(o.customer_id)) || "Walk-in"} · {formatDate(o.occurred_at)}
                </div>
              </div>
              <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums">
                {formatMoney(o.total, profile.currency)}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
