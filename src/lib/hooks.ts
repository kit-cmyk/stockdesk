"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, DEFAULT_PROFILE, PROFILE_ID } from "./db";
import {
  isLowStock,
  movementGrossRevenue,
  movementNetRevenue,
  movementProfit,
  stockValue,
} from "./inventory";
import { dailySalesSeries } from "./metrics";
import { isOverdue } from "./customers";
import type {
  Customer,
  Invoice,
  InvoiceStatus,
  MovementType,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  Product,
  Profile,
  StockMovement,
} from "./types";
import { daysAgoIso } from "./utils";

export function useProfile(): Profile | undefined {
  // Read-only: liveQuery contexts forbid writes. The profile row is created
  // at startup by ensureProfile() in providers.tsx; here we just observe it,
  // falling back to the default until that write lands.
  return useLiveQuery(async () => (await db.profiles.get(PROFILE_ID)) ?? DEFAULT_PROFILE, []);
}

export function useProducts(opts?: { includeArchived?: boolean }): Product[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.products.orderBy("name").toArray();
    return opts?.includeArchived ? all : all.filter((p) => !p.is_archived);
  }, [opts?.includeArchived]);
}

// Single-row hooks resolve to `null` when the row does not exist so pages can
// distinguish "still loading" (undefined) from "not found" (null) — Dexie's
// get() returns undefined for both.
export function useProduct(id: string | undefined): Product | null | undefined {
  return useLiveQuery(async () => (id ? (await db.products.get(id)) ?? null : null), [id]);
}

export function useProductMovements(productId: string | undefined): StockMovement[] | undefined {
  return useLiveQuery(async () => {
    if (!productId) return [];
    const rows = await db.movements.where("product_id").equals(productId).toArray();
    return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [productId]);
}

export interface MovementFilters {
  type?: MovementType | "all";
  productId?: string;
  customerId?: string;
  from?: string; // inclusive ISO lower bound on occurred_at
  to?: string; // inclusive ISO upper bound on occurred_at
  limit?: number;
}

export function useMovements(filters?: MovementFilters | number): StockMovement[] | undefined {
  const opts: MovementFilters = typeof filters === "number" ? { limit: filters } : filters ?? {};
  const { type, productId, customerId, from, to, limit = 200 } = opts;
  return useLiveQuery(async () => {
    let rows = await db.movements.orderBy("occurred_at").reverse().toArray();
    if (type && type !== "all") rows = rows.filter((m) => m.type === type);
    if (productId) rows = rows.filter((m) => m.product_id === productId);
    if (customerId) rows = rows.filter((m) => m.customer_id === customerId);
    if (from) rows = rows.filter((m) => m.occurred_at >= from);
    if (to) rows = rows.filter((m) => m.occurred_at <= to);
    return rows.slice(0, limit);
  }, [type, productId, customerId, from, to, limit]);
}

export function useAllMovements(): StockMovement[] | undefined {
  return useLiveQuery(() => db.movements.toArray(), []);
}

export function useStockCounts() {
  return useLiveQuery(() => db.stockCounts.orderBy("created_at").reverse().toArray(), []);
}

export function useStockCount(id: string | undefined) {
  return useLiveQuery(async () => (id ? (await db.stockCounts.get(id)) ?? null : null), [id]);
}

export function useCountItems(countId: string | undefined) {
  return useLiveQuery(
    () => (countId ? db.stockCountItems.where("count_id").equals(countId).toArray() : []),
    [countId]
  );
}

export function useCategories() {
  return useLiveQuery(() => db.categories.orderBy("name").toArray(), []);
}
export function useSuppliers() {
  return useLiveQuery(() => db.suppliers.orderBy("name").toArray(), []);
}
export function useCustomers() {
  return useLiveQuery(() => db.customers.orderBy("name").toArray(), []);
}
export function useCustomer(id: string | undefined): Customer | null | undefined {
  return useLiveQuery(async () => (id ? (await db.customers.get(id)) ?? null : null), [id]);
}
export function usePendingSync(): number | undefined {
  return useLiveQuery(() => db.outbox.count(), []);
}

export interface OutboxStatus {
  pending: number;
  failed: number; // permanently-rejected entries needing attention
  lastError?: string;
}

export function useOutboxStatus(): OutboxStatus | undefined {
  return useLiveQuery(async () => {
    const entries = await db.outbox.toArray();
    const failed = entries.filter((e) => e.permanent);
    return {
      pending: entries.length,
      failed: failed.length,
      lastError: failed[0]?.last_error ?? entries.find((e) => e.last_error)?.last_error,
    };
  }, []);
}

/** Row ids with local changes still waiting to sync — for per-item "pending" badges. */
export function usePendingRowIds(): Set<string> | undefined {
  return useLiveQuery(async () => {
    const entries = await db.outbox.toArray();
    const ids = new Set<string>();
    for (const e of entries) {
      const id = (e.payload as { id?: string } | null)?.id;
      if (id) ids.add(id);
    }
    return ids;
  }, []);
}

/** True while the browser reports no connectivity (SSR-safe). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

// ---------- Orders ----------

export function useOrders(status?: OrderStatus | "all"): Order[] | undefined {
  return useLiveQuery(async () => {
    // `created_at` isn't an indexed key on the orders store, so sort in memory
    // rather than via orderBy() (which requires an index).
    const all = await db.orders.toArray();
    all.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return status && status !== "all" ? all.filter((o) => o.status === status) : all;
  }, [status]);
}

export function useOrder(id: string | undefined): Order | null | undefined {
  return useLiveQuery(async () => (id ? (await db.orders.get(id)) ?? null : null), [id]);
}

export function useOrderItems(orderId: string | undefined): OrderItem[] | undefined {
  return useLiveQuery(
    () => (orderId ? db.orderItems.where("order_id").equals(orderId).toArray() : []),
    [orderId]
  );
}

export function useCustomerOrders(customerId: string | undefined): Order[] | undefined {
  return useLiveQuery(async () => {
    if (!customerId) return [];
    const rows = await db.orders.where("customer_id").equals(customerId).toArray();
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [customerId]);
}

// ---------- Invoices & payments ----------

export function useInvoices(status?: InvoiceStatus | "all"): Invoice[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.invoices.orderBy("issued_at").reverse().toArray();
    return status && status !== "all" ? all.filter((i) => i.status === status) : all;
  }, [status]);
}

export function useInvoice(id: string | undefined): Invoice | null | undefined {
  return useLiveQuery(async () => (id ? (await db.invoices.get(id)) ?? null : null), [id]);
}

export function useInvoiceForOrder(orderId: string | undefined): Invoice | undefined {
  return useLiveQuery(
    () => (orderId ? db.invoices.where("order_id").equals(orderId).first() : undefined),
    [orderId]
  );
}

export function useCustomerInvoices(customerId: string | undefined): Invoice[] | undefined {
  return useLiveQuery(async () => {
    if (!customerId) return [];
    const rows = await db.invoices.where("customer_id").equals(customerId).toArray();
    return rows.sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  }, [customerId]);
}

export function usePayments(invoiceId: string | undefined): Payment[] | undefined {
  return useLiveQuery(async () => {
    if (!invoiceId) return [];
    const rows = await db.payments.where("invoice_id").equals(invoiceId).toArray();
    return rows.sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  }, [invoiceId]);
}

export function useCustomerSales(customerId: string | undefined): StockMovement[] | undefined {
  return useLiveQuery(async () => {
    if (!customerId) return [];
    const rows = await db.movements.where("customer_id").equals(customerId).toArray();
    return rows
      .filter((m) => m.type === "sale")
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [customerId]);
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- Home dashboard ----------

export interface ReceivableRow {
  customerId?: string; // undefined = walk-in
  name: string;
  balance: number;
  overdue: boolean;
  invoiceCount: number;
}

export interface TopSeller {
  product: Product;
  units: number;
  profit: number;
  netRevenue: number;
}

export interface HomeData {
  // Total sales this calendar month (month-to-date).
  monthNet: number; // ex-tax revenue
  monthGross: number; // what customers paid
  monthUnits: number;
  monthOrders: number; // distinct orders + standalone sales
  monthDaily: number[]; // net revenue per day, month-to-date (for sparkline/chart)
  // SSOT §8 screen-2 KPIs.
  skuCount: number;
  stockValue: number; // total on-hand value at avg cost
  todayNet: number;
  todayProfit: number;
  net7d: number;
  profit7d: number;
  net30d: number;
  profit30d: number;
  tax30d: number; // output tax collected, last 30 days
  topSellers: TopSeller[]; // by 30d profit
  // Pending (draft) orders not yet confirmed.
  pendingOrders: Order[];
  pendingOrdersValue: number;
  // Low stock products (at/under their reorder point, or negative).
  lowStock: Product[];
  // Customers (and walk-ins) with unpaid/partial invoices.
  receivables: ReceivableRow[];
  receivablesTotal: number;
}

export function useHomeData(profile: Profile | undefined): HomeData | undefined {
  return useLiveQuery(async () => {
    if (!profile) return undefined;
    const [products, movements, orders, invoices, customers] = await Promise.all([
      db.products.toArray(),
      db.movements.toArray(),
      db.orders.toArray(),
      db.invoices.toArray(),
      db.customers.toArray(),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthSales = movements.filter((m) => m.type === "sale" && m.occurred_at >= monthStart);

    const monthNet = round2(monthSales.reduce((s, m) => s + movementNetRevenue(m), 0));
    const monthGross = round2(monthSales.reduce((s, m) => s + movementGrossRevenue(m), 0));
    const monthUnits = monthSales.reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
    const orderIds = new Set<string>();
    let standalone = 0;
    for (const m of monthSales) {
      if (m.order_id) orderIds.add(m.order_id);
      else standalone++;
    }
    const monthDaily = dailySalesSeries(monthSales, now.getDate()).map((d) => d.revenue);

    // SSOT KPIs: today / 7d / 30d revenue & profit, tax collected, top sellers.
    const active = products.filter((p) => !p.is_archived);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const since7 = daysAgoIso(7);
    const since30 = daysAgoIso(30);
    const sales30 = movements.filter((m) => m.type === "sale" && m.occurred_at >= since30);
    const sumNet = (rows: StockMovement[]) => round2(rows.reduce((t, m) => t + movementNetRevenue(m), 0));
    const sumProfit = (rows: StockMovement[]) => round2(rows.reduce((t, m) => t + movementProfit(m), 0));
    const salesToday = sales30.filter((m) => m.occurred_at >= todayStart);
    const sales7 = sales30.filter((m) => m.occurred_at >= since7);

    const byProduct = new Map<string, { units: number; profit: number; netRevenue: number }>();
    for (const m of sales30) {
      const row = byProduct.get(m.product_id) ?? { units: 0, profit: 0, netRevenue: 0 };
      row.units += Math.abs(m.quantity_delta);
      row.profit += movementProfit(m);
      row.netRevenue += movementNetRevenue(m);
      byProduct.set(m.product_id, row);
    }
    const productById = new Map(products.map((p) => [p.id, p] as const));
    const topSellers: TopSeller[] = [...byProduct.entries()]
      .map(([id, agg]) => ({
        product: productById.get(id),
        units: agg.units,
        profit: round2(agg.profit),
        netRevenue: round2(agg.netRevenue),
      }))
      .filter((t): t is TopSeller => Boolean(t.product))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    const pendingOrders = orders
      .filter((o) => o.status === "draft")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pendingOrdersValue = round2(pendingOrders.reduce((s, o) => s + o.total, 0));

    const lowStock = products
      .filter((p) => !p.is_archived && isLowStock(p, profile))
      .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand);

    const custName = new Map(customers.map((c) => [c.id, c.name] as const));
    const byCustomer = new Map<string, ReceivableRow>();
    for (const inv of invoices) {
      if (inv.status !== "unpaid" && inv.status !== "partial") continue;
      const balance = inv.total - inv.amount_paid;
      if (balance <= 0) continue;
      const key = inv.customer_id ?? "__walkin__";
      const row =
        byCustomer.get(key) ??
        ({
          customerId: inv.customer_id,
          name: inv.customer_id ? custName.get(inv.customer_id) ?? "Unknown" : "Walk-in",
          balance: 0,
          overdue: false,
          invoiceCount: 0,
        } satisfies ReceivableRow);
      row.balance += balance;
      row.invoiceCount += 1;
      if (isOverdue(inv, now)) row.overdue = true;
      byCustomer.set(key, row);
    }
    const receivables = [...byCustomer.values()]
      .map((r) => ({ ...r, balance: round2(r.balance) }))
      .sort((a, b) => b.balance - a.balance);
    const receivablesTotal = round2(receivables.reduce((s, r) => s + r.balance, 0));

    return {
      monthNet,
      monthGross,
      monthUnits,
      monthOrders: orderIds.size + standalone,
      monthDaily,
      skuCount: active.length,
      stockValue: round2(active.reduce((t, p) => t + stockValue(p), 0)),
      todayNet: sumNet(salesToday),
      todayProfit: sumProfit(salesToday),
      net7d: sumNet(sales7),
      profit7d: sumProfit(sales7),
      net30d: sumNet(sales30),
      profit30d: sumProfit(sales30),
      tax30d: round2(sales30.reduce((t, m) => t + (m.tax_amount ?? 0), 0)),
      topSellers,
      pendingOrders,
      pendingOrdersValue,
      lowStock,
      receivables,
      receivablesTotal,
    };
  }, [profile?.id, profile?.updated_at]);
}
