// Pure inventory + tax math. The single source of truth for costing logic on the
// client. The same rules are mirrored in the Supabase DB triggers (see migration).

import {
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  type MovementType,
  type Product,
  type Profile,
  type StockMovement,
} from "./types";

export function isInbound(type: MovementType): boolean {
  return INBOUND_TYPES.includes(type);
}
export function isOutbound(type: MovementType): boolean {
  return OUTBOUND_TYPES.includes(type);
}

export function signedDelta(type: MovementType, qty: number): number {
  const magnitude = Math.abs(Math.trunc(qty));
  if (isInbound(type)) return magnitude;
  if (isOutbound(type)) return -magnitude;
  return Math.trunc(qty); // adjustment: caller provides signed value
}

/** Resolve the tax rate that applies to a product (override -> profile default). */
export function effectiveTaxRate(product: Product, profile: Profile): number {
  return product.tax_rate ?? profile.default_tax_rate ?? 0;
}

/**
 * Compute the tax portion of a line total.
 * Inclusive: tax is carved out of the total. Exclusive: tax is added on top.
 */
export function taxFromLineTotal(
  lineTotal: number,
  taxRate: number,
  inclusive: boolean
): number {
  if (!taxRate) return 0;
  if (inclusive) {
    return round2(lineTotal - lineTotal / (1 + taxRate / 100));
  }
  return round2(lineTotal * (taxRate / 100));
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export interface MovementResult {
  nextProduct: Product;
  movement: StockMovement;
}

/**
 * Apply a movement to a product, producing the next product state (avg_cost,
 * quantity_on_hand) and the fully-computed movement (tax_amount, cogs_unit).
 * Does NOT mutate inputs.
 */
export function applyMovement(
  product: Product,
  profile: Profile,
  input: {
    client_id: string;
    id: string;
    type: MovementType;
    quantity: number; // magnitude for in/out; signed for adjustment
    unit_cost?: number;
    unit_price?: number;
    supplier_id?: string;
    customer_id?: string;
    order_id?: string;
    reference?: string;
    note?: string;
    occurred_at: string;
  }
): MovementResult {
  const delta = signedDelta(input.type, input.quantity);
  const qoh = product.quantity_on_hand;
  let nextAvg = product.avg_cost;
  let nextQoh = qoh + delta;
  let cogs_unit: number | undefined;
  let tax_rate: number | undefined;
  let tax_amount: number | undefined;

  const inbound = delta > 0 && (isInbound(input.type) || input.type === "adjustment");
  const outbound = delta < 0;

  if (inbound && input.unit_cost != null) {
    // Moving weighted average on inbound with a known cost.
    const inQty = delta;
    const denom = qoh + inQty;
    nextAvg =
      denom > 0
        ? round4((qoh * product.avg_cost + inQty * input.unit_cost) / denom)
        : round4(input.unit_cost);
  }

  if (outbound) {
    // Capture cost of goods at the current average; avg_cost is unchanged by outflows.
    cogs_unit = product.avg_cost;
  }

  // Tax: applies to sales (output tax) and purchases (input tax).
  let tax_inclusive: boolean | undefined;
  if (input.type === "sale" && input.unit_price != null) {
    tax_rate = effectiveTaxRate(product, profile);
    const lineTotal = Math.abs(delta) * input.unit_price;
    tax_amount = taxFromLineTotal(lineTotal, tax_rate, profile.prices_tax_inclusive);
    // Snapshot the pricing mode so net revenue stays correct even if the
    // profile flag is changed later.
    tax_inclusive = profile.prices_tax_inclusive;
  } else if (input.type === "purchase" && input.unit_cost != null) {
    tax_rate = effectiveTaxRate(product, profile);
    // Purchase costs are stored ex-tax; input tax is computed on top for reporting.
    const lineTotal = Math.abs(delta) * input.unit_cost;
    tax_amount = taxFromLineTotal(
      lineTotal,
      tax_rate,
      false /* unit_cost is ex-tax, so tax is added on top */
    );
  }

  const now = new Date().toISOString();
  const movement: StockMovement = {
    id: input.id,
    client_id: input.client_id,
    product_id: product.id,
    type: input.type,
    quantity_delta: delta,
    unit_cost: input.unit_cost,
    unit_price: input.unit_price,
    tax_rate,
    tax_amount,
    tax_inclusive,
    cogs_unit,
    supplier_id: input.supplier_id,
    customer_id: input.customer_id,
    order_id: input.order_id,
    reference: input.reference,
    note: input.note,
    occurred_at: input.occurred_at,
    created_at: now,
  };

  const nextProduct: Product = {
    ...product,
    avg_cost: nextAvg,
    quantity_on_hand: nextQoh,
    updated_at: now,
  };

  return { nextProduct, movement };
}

// ---- Derived per-movement figures (for ledger / reports) ----

export function movementUnitsSold(m: StockMovement): number {
  return m.type === "sale" ? Math.abs(m.quantity_delta) : 0;
}

/**
 * What the customer actually paid. With tax-inclusive prices that's qty×price;
 * with tax-exclusive prices the tax is added on top of the entered price.
 * Movements recorded before the `tax_inclusive` snapshot existed are treated
 * as inclusive (the historical default).
 */
export function movementGrossRevenue(m: StockMovement): number {
  if (m.type !== "sale" || m.unit_price == null) return 0;
  const lineTotal = Math.abs(m.quantity_delta) * m.unit_price;
  const inclusive = m.tax_inclusive ?? true;
  return round2(inclusive ? lineTotal : lineTotal + (m.tax_amount ?? 0));
}

/** Ex-tax revenue — the figure profit is based on. */
export function movementNetRevenue(m: StockMovement): number {
  if (m.type !== "sale" || m.unit_price == null) return 0;
  const lineTotal = Math.abs(m.quantity_delta) * m.unit_price;
  const inclusive = m.tax_inclusive ?? true;
  // Inclusive: tax is carved out of the entered price. Exclusive: the entered
  // price already is the net amount (tax sits on top) — do NOT deduct it again.
  return round2(inclusive ? lineTotal - (m.tax_amount ?? 0) : lineTotal);
}

export function movementCogs(m: StockMovement): number {
  if (m.type !== "sale" || m.cogs_unit == null) return 0;
  return round2(Math.abs(m.quantity_delta) * m.cogs_unit);
}

export function movementProfit(m: StockMovement): number {
  if (m.type !== "sale") return 0;
  return round2(movementNetRevenue(m) - movementCogs(m));
}

export function lineValueIn(m: StockMovement): number {
  if (m.quantity_delta <= 0 || m.unit_cost == null) return 0;
  return round2(m.quantity_delta * m.unit_cost);
}

// ---- Product-level metrics ----

export function stockValue(p: Product): number {
  return round2(p.quantity_on_hand * p.avg_cost);
}

export function isLowStock(p: Product, profile: Profile): boolean {
  // Negative stock always counts as needing attention, even with no threshold.
  if (p.quantity_on_hand < 0) return true;
  const threshold = p.reorder_point ?? profile.low_stock_default ?? 0;
  return threshold > 0 && p.quantity_on_hand <= threshold;
}

/**
 * UI badge state for a product's stock level. Negative stock is flagged
 * distinctly ("sold before recorded receipt") until reconciled — SSOT §6.
 */
export function stockFlag(p: Product, profile: Profile): "negative" | "low" | null {
  if (p.quantity_on_hand < 0) return "negative";
  return isLowStock(p, profile) ? "low" : null;
}

/** Net (ex-tax) sale price for a product, for margin display. */
export function netSalePrice(p: Product, profile: Profile): number | undefined {
  if (p.sell_price == null) return undefined;
  const rate = effectiveTaxRate(p, profile);
  if (profile.prices_tax_inclusive && rate) {
    return round2(p.sell_price / (1 + rate / 100));
  }
  return p.sell_price;
}

export function marginPct(p: Product, profile: Profile): number | undefined {
  const net = netSalePrice(p, profile);
  if (net == null || net === 0) return undefined;
  return round2(((net - p.avg_cost) / net) * 100);
}

export function earningsPerUnit(p: Product, profile: Profile): number | undefined {
  const net = netSalePrice(p, profile);
  if (net == null) return undefined;
  return round2(net - p.avg_cost);
}
