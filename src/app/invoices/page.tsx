"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, EmptyState, FilterBar, FilterSelect, PageHeader, ListSkeleton } from "@/components/ui";
import { useCustomers, useInvoices, useProfile } from "@/lib/hooks";
import { isOverdue, outstandingBalance } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/utils";
import type { Invoice, InvoiceStatus } from "@/lib/types";

function tone(inv: Invoice): "neutral" | "success" | "warning" | "danger" {
  if (inv.status === "paid") return "success";
  if (inv.status === "void") return "neutral";
  if (isOverdue(inv)) return "danger";
  return "warning";
}

export default function InvoicesPage() {
  const profile = useProfile();
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const invoices = useInvoices(status);
  const allInvoices = useInvoices("all");
  const customers = useCustomers();

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    customers?.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);

  if (!profile || !invoices)
    return (
      <div>
        <PageHeader title="Invoices" />
        <ListSkeleton />
      </div>
    );

  const outstanding = outstandingBalance(allInvoices ?? []);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={
          outstanding > 0
            ? `${formatMoney(outstanding, profile.currency)} outstanding`
            : "All settled"
        }
      />

      <FilterBar>
        <FilterSelect
          value={status}
          onChange={(e) => setStatus(e.target.value as InvoiceStatus | "all")}
          aria-label="Filter by status"
        >
          <option value="all">All invoices</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </FilterSelect>
      </FilterBar>

      <div className="mt-3 space-y-2 px-4">
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices"
            body="Invoices are created automatically when you confirm an order."
          />
        ) : (
          invoices.map((inv) => {
            const balance = Math.max(0, inv.total - inv.amount_paid);
            return (
              <Link
                key={inv.id}
                href={`/invoices/${inv.id}`}
                className="flex items-center justify-between rounded-2xl bg-surface p-3 ring-1 ring-border"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{inv.invoice_no}</span>
                    <Badge tone={tone(inv)}>{isOverdue(inv) ? "overdue" : inv.status}</Badge>
                  </div>
                  <div className="text-xs text-muted">
                    {(inv.customer_id && customerName.get(inv.customer_id)) || "Walk-in"} ·{" "}
                    {formatDate(inv.issued_at)}
                  </div>
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    {formatMoney(inv.total, profile.currency)}
                  </div>
                  {balance > 0 && inv.status !== "void" && (
                    <div className="text-xs text-warning">
                      {formatMoney(balance, profile.currency)} due
                    </div>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
