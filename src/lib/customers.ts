// Per-customer rollups derived from the sale ledger + invoices. Pure functions,
// mirroring the style of metrics.ts. Revenue/profit reuse the same movement math
// as the rest of the app so figures are consistent everywhere.

import { movementNetRevenue, movementProfit, round2 } from "./inventory";
import type { Invoice, StockMovement } from "./types";

export interface CustomerRollup {
  lifetimeNetRevenue: number; // ex-tax revenue
  lifetimeProfit: number;
  unitsSold: number;
  orderCount: number; // distinct orders + standalone sales
  lastOrderAt?: string;
  outstandingBalance: number; // unpaid invoice balance owed
}

/**
 * @param sales    the customer's `sale` movements
 * @param invoices the customer's invoices (any status)
 */
export function customerRollup(sales: StockMovement[], invoices: Invoice[]): CustomerRollup {
  let net = 0;
  let profit = 0;
  let units = 0;
  let lastOrderAt: string | undefined;
  const orderIds = new Set<string>();
  let standalone = 0;

  for (const m of sales) {
    net += movementNetRevenue(m);
    profit += movementProfit(m);
    units += Math.abs(m.quantity_delta);
    if (!lastOrderAt || m.occurred_at > lastOrderAt) lastOrderAt = m.occurred_at;
    if (m.order_id) orderIds.add(m.order_id);
    else standalone++;
  }

  const outstandingBalance = invoices
    .filter((i) => i.status !== "void")
    .reduce((s, i) => s + (i.total - i.amount_paid), 0);

  return {
    lifetimeNetRevenue: round2(net),
    lifetimeProfit: round2(profit),
    unitsSold: units,
    orderCount: orderIds.size + standalone,
    lastOrderAt,
    outstandingBalance: round2(outstandingBalance),
  };
}

/** Outstanding (unpaid + partial, non-void) balance across a set of invoices. */
export function outstandingBalance(invoices: Invoice[]): number {
  return round2(
    invoices.filter((i) => i.status !== "void").reduce((s, i) => s + (i.total - i.amount_paid), 0)
  );
}

/** An invoice is overdue if it has a due date in the past and is not settled. */
export function isOverdue(inv: Invoice, now = new Date()): boolean {
  if (inv.status === "paid" || inv.status === "void") return false;
  if (!inv.due_at) return false;
  return new Date(inv.due_at).getTime() < now.getTime();
}
