// Phase B analytics. Pure functions over the movement ledger.
// The ledger is complete and append-only, so historical figures (e.g. inventory
// value over time) are reconstructed by replaying movements — no stored history needed.

import { applyMovement, movementCogs, movementNetRevenue, movementProfit } from "./inventory";
import type { Product, Profile, StockMovement } from "./types";

export const DEFAULT_LEAD_DAYS = 14;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD strings for the last `days` days ending today. */
export function dayAxis(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Per-product metrics over a window
// ---------------------------------------------------------------------------
export interface ProductMetrics {
  unitsSold: number;
  unitsReceived: number;
  available: number; // start-of-window on-hand + received in window
  sellThroughPct: number;
  avgDailySales: number;
  daysOfInventory: number | null; // null = no recent sales
  revenue: number;
  profit: number;
  reorderSuggestion: number;
}

export function productMetrics(
  product: Product,
  movements: StockMovement[],
  days: number,
  leadDays = DEFAULT_LEAD_DAYS
): ProductMetrics {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const inWindow = movements.filter(
    (m) => m.product_id === product.id && m.occurred_at >= sinceIso
  );

  const unitsSold = inWindow
    .filter((m) => m.type === "sale")
    .reduce((s, m) => s + Math.abs(m.quantity_delta), 0);
  const unitsReceived = inWindow
    .filter((m) => m.type === "purchase" || m.type === "return_in" || m.type === "opening")
    .reduce((s, m) => s + Math.abs(m.quantity_delta), 0);

  const netDelta = inWindow.reduce((s, m) => s + m.quantity_delta, 0);
  const startOnHand = product.quantity_on_hand - netDelta;
  const available = Math.max(0, startOnHand) + unitsReceived;

  const sellThroughPct = available > 0 ? round2((unitsSold / available) * 100) : 0;
  const avgDailySales = round2(unitsSold / days);
  const daysOfInventory =
    avgDailySales > 0 ? Math.round(product.quantity_on_hand / avgDailySales) : null;

  const revenue = round2(inWindow.reduce((s, m) => s + movementNetRevenue(m), 0));
  const profit = round2(inWindow.reduce((s, m) => s + movementProfit(m), 0));

  // Velocity-based reorder suggestion: cover lead time + reorder point buffer.
  let reorderSuggestion = 0;
  if (avgDailySales > 0) {
    const buffer = product.reorder_point ?? 0;
    const target = Math.ceil(avgDailySales * leadDays + buffer);
    reorderSuggestion = Math.max(0, target - product.quantity_on_hand);
  } else if (product.reorder_qty && product.quantity_on_hand <= (product.reorder_point ?? 0)) {
    reorderSuggestion = product.reorder_qty;
  }

  return {
    unitsSold,
    unitsReceived,
    available,
    sellThroughPct,
    avgDailySales,
    daysOfInventory,
    revenue,
    profit,
    reorderSuggestion,
  };
}

// ---------------------------------------------------------------------------
// Daily sales series (revenue / profit / units)
// ---------------------------------------------------------------------------
export interface DailyPoint {
  date: string;
  revenue: number;
  profit: number;
  units: number;
}

export function dailySalesSeries(movements: StockMovement[], days: number): DailyPoint[] {
  const axis = dayAxis(days);
  const map = new Map<string, DailyPoint>();
  axis.forEach((d) => map.set(d, { date: d, revenue: 0, profit: 0, units: 0 }));

  for (const m of movements) {
    if (m.type !== "sale") continue;
    const key = dayKey(m.occurred_at);
    const pt = map.get(key);
    if (!pt) continue;
    pt.revenue = round2(pt.revenue + movementNetRevenue(m));
    pt.profit = round2(pt.profit + movementProfit(m));
    pt.units += Math.abs(m.quantity_delta);
  }
  return axis.map((d) => map.get(d)!);
}

// ---------------------------------------------------------------------------
// Inventory value over time — exact, via full ledger replay
// ---------------------------------------------------------------------------
export interface ValuePoint {
  date: string;
  value: number;
}

export function inventoryValueSeries(
  allMovements: StockMovement[],
  products: Product[],
  profile: Profile,
  days: number
): ValuePoint[] {
  // Replay every movement chronologically, tracking qty + avg cost per product.
  const sorted = [...allMovements].sort((a, b) => {
    const c = a.occurred_at.localeCompare(b.occurred_at);
    return c !== 0 ? c : a.created_at.localeCompare(b.created_at);
  });

  const state = new Map<string, { qty: number; avg: number }>();
  const ensure = (id: string) => {
    let s = state.get(id);
    if (!s) {
      s = { qty: 0, avg: 0 };
      state.set(id, s);
    }
    return s;
  };

  const axis = dayAxis(days);
  const firstDay = axis[0];
  const valueByDay = new Map<string, number>();

  const totalValue = () => {
    let t = 0;
    for (const s of state.values()) t += s.qty * s.avg;
    return round2(t);
  };

  // Build a lightweight product lookup so replay can use applyMovement's math.
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const m of sorted) {
    const s = ensure(m.product_id);
    const proxy: Product = {
      ...(productById.get(m.product_id) ?? ({} as Product)),
      id: m.product_id,
      quantity_on_hand: s.qty,
      avg_cost: s.avg,
    };
    const { nextProduct } = applyMovement(proxy, profile, {
      client_id: m.client_id,
      id: m.id,
      type: m.type,
      quantity: m.quantity_delta, // already signed
      unit_cost: m.unit_cost,
      unit_price: m.unit_price,
      occurred_at: m.occurred_at,
    });
    s.qty = nextProduct.quantity_on_hand;
    s.avg = nextProduct.avg_cost;

    const k = dayKey(m.occurred_at);
    if (k >= firstDay) valueByDay.set(k, totalValue());
  }

  // Carry forward the last known value across gaps.
  let last = 0;
  // Seed `last` with the value as of the start of the window (state before firstDay
  // is already captured in `state` because we replayed everything up to here).
  last = totalValue();
  // Recompute by walking axis; for days with a recorded snapshot use it, else carry.
  const result: ValuePoint[] = [];
  // Determine value at end of each axis day: replay already advanced state fully, so
  // for days before any movement we approximate with the earliest snapshot.
  const snapshots = axis.map((d) => valueByDay.get(d));
  // Forward-fill: find first defined snapshot to back-fill leading gaps.
  const firstDefined = snapshots.find((v) => v !== undefined) ?? last;
  let carry = firstDefined;
  axis.forEach((d, i) => {
    const v = snapshots[i];
    if (v !== undefined) carry = v;
    result.push({ date: d, value: carry });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Portfolio turnover for a window
// ---------------------------------------------------------------------------
export function inventoryTurnover(
  allMovements: StockMovement[],
  products: Product[],
  profile: Profile,
  days: number
): number {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();
  const cogs = allMovements
    .filter((m) => m.type === "sale" && m.occurred_at >= sinceIso)
    .reduce((s, m) => s + movementCogs(m), 0);

  const series = inventoryValueSeries(allMovements, products, profile, days);
  const startValue = series[0]?.value ?? 0;
  const endValue = series[series.length - 1]?.value ?? 0;
  const avgInv = (startValue + endValue) / 2;
  return avgInv > 0 ? round2(cogs / avgInv) : 0;
}
