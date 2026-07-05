"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, PageHeader, SearchInput, ListSkeleton } from "@/components/ui";
import { FilterBar } from "@/components/ui";
import { CustomerFormSheet } from "@/components/CustomerFormSheet";
import { useAllMovements, useCustomers, useInvoices, useProfile } from "@/lib/hooks";
import { customerRollup } from "@/lib/customers";
import { formatMoney } from "@/lib/utils";
import type { Invoice, StockMovement } from "@/lib/types";

export default function CustomersPage() {
  const profile = useProfile();
  const customers = useCustomers();
  const movements = useAllMovements();
  const invoices = useInvoices("all");
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const rollups = useMemo(() => {
    const salesByCustomer = new Map<string, StockMovement[]>();
    for (const m of movements ?? []) {
      if (m.type !== "sale" || !m.customer_id) continue;
      const arr = salesByCustomer.get(m.customer_id) ?? [];
      arr.push(m);
      salesByCustomer.set(m.customer_id, arr);
    }
    const invByCustomer = new Map<string, Invoice[]>();
    for (const i of invoices ?? []) {
      if (!i.customer_id) continue;
      const arr = invByCustomer.get(i.customer_id) ?? [];
      arr.push(i);
      invByCustomer.set(i.customer_id, arr);
    }
    const map = new Map<string, ReturnType<typeof customerRollup>>();
    for (const c of customers ?? []) {
      map.set(c.id, customerRollup(salesByCustomer.get(c.id) ?? [], invByCustomer.get(c.id) ?? []));
    }
    return map;
  }, [customers, movements, invoices]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (customers ?? []).filter(
      (c) => !needle || c.name.toLowerCase().includes(needle) || c.contact?.toLowerCase().includes(needle)
    );
    return rows.sort((a, b) => {
      const ra = rollups.get(a.id)?.lifetimeNetRevenue ?? 0;
      const rb = rollups.get(b.id)?.lifetimeNetRevenue ?? 0;
      return rb - ra;
    });
  }, [customers, q, rollups]);

  if (!profile || !customers)
    return (
      <div>
        <PageHeader title="Customers" />
        <ListSkeleton />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} ${customers.length === 1 ? "customer" : "customers"}`}
        action={<Button className="h-10 px-3" onClick={() => setAddOpen(true)}>+ Add</Button>}
      />

      <FilterBar>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" />
      </FilterBar>

      <div className="mt-3 space-y-2 px-4">
        {visible.length === 0 ? (
          <EmptyState
            title={q ? "No matches" : "No customers yet"}
            body={q ? "Try a different search." : "Add a customer to start tracking their orders."}
            action={!q && <Button onClick={() => setAddOpen(true)}>Add a customer</Button>}
          />
        ) : (
          visible.map((c) => {
            const r = rollups.get(c.id);
            const owed = r?.outstandingBalance ?? 0;
            return (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base font-bold text-muted">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {owed > 0 && <Badge tone="warning">{formatMoney(owed, profile.currency)} due</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {r ? `${r.orderCount} ${r.orderCount === 1 ? "order" : "orders"}` : "No orders"}
                    {c.contact ? ` · ${c.contact}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold tabular-nums">
                    {formatMoney(r?.lifetimeNetRevenue ?? 0, profile.currency)}
                  </div>
                  <div className="text-[10px] text-muted">lifetime</div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      <CustomerFormSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => setAddOpen(false)}
      />
    </div>
  );
}
