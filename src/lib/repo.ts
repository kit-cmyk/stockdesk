// Repository layer: all writes go through here so the inventory/tax math and the
// sync outbox stay consistent. Reads are done reactively via dexie-react-hooks.

import { db, ensureProfile, nextNumber } from "./db";
import { applyMovement, effectiveTaxRate, round2, taxFromLineTotal } from "./inventory";
import type {
  Category,
  Customer,
  Invoice,
  InvoiceStatus,
  MovementType,
  Order,
  OrderItem,
  Payment,
  Product,
  Profile,
  StockCount,
  StockCountItem,
  StockMovement,
  Supplier,
} from "./types";
import { newId, nowIso } from "./utils";
import { enqueue } from "./sync";

// ---------- Profile ----------

export async function getProfile(): Promise<Profile> {
  return ensureProfile();
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  const current = await ensureProfile();
  const next: Profile = { ...current, ...patch, updated_at: nowIso() };
  // Guard rails: these values feed every price/tax computation in the app.
  next.display_name = next.display_name.trim() || current.display_name || "My Store";
  next.tax_label = next.tax_label.trim() || "Tax";
  next.default_tax_rate = clampTaxRate(next.default_tax_rate);
  next.low_stock_default = Math.max(0, Math.trunc(next.low_stock_default || 0));
  next.invoice_due_days = Math.max(0, Math.trunc(next.invoice_due_days || 0));
  await db.profiles.put(next);
  await enqueue("profile", "upsert", next);
}

/** Tax rates are percentages: keep them in [0, 100]. */
export function clampTaxRate(rate: number | undefined): number {
  if (rate == null || !Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, round2(rate)));
}

/** Money inputs must be finite and non-negative, at 2dp. */
function cleanMoney(value: number | undefined, label: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) throw new Error(`${label} is not a valid number`);
  if (value < 0) throw new Error(`${label} cannot be negative`);
  return round2(value);
}

// ---------- Products ----------

export interface ProductInput {
  id?: string;
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  category_id?: string;
  default_supplier_id?: string;
  unit?: string;
  /** string = set thumbnail photo, null = remove, undefined = leave unchanged. */
  image_data?: string | null;
  /** All photos incl. thumbnail. array = set, null = clear, undefined = leave unchanged. */
  images?: string[] | null;
  sell_price?: number;
  tax_rate?: number;
  reorder_point?: number;
  reorder_qty?: number;
}

/** Throw when another product already uses this SKU or barcode (SSOT: unique when set). */
async function assertUniqueCodes(input: ProductInput): Promise<void> {
  const sku = input.sku?.trim().toLowerCase();
  const barcode = input.barcode?.trim();
  if (!sku && !barcode) return;
  const all = await db.products.toArray();
  for (const p of all) {
    if (p.id === input.id) continue;
    if (sku && p.sku?.trim().toLowerCase() === sku) {
      throw new Error(`SKU "${input.sku}" is already used by "${p.name}"`);
    }
    if (barcode && p.barcode?.trim() === barcode) {
      throw new Error(`Barcode ${barcode} is already used by "${p.name}"`);
    }
  }
}

function cleanReorder(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  return Math.max(0, Math.trunc(value));
}

export async function saveProduct(input: ProductInput): Promise<string> {
  const now = nowIso();
  await assertUniqueCodes(input);
  const sell_price = cleanMoney(input.sell_price, "Sell price");
  const tax_rate = input.tax_rate == null ? undefined : clampTaxRate(input.tax_rate);
  if (input.id) {
    const existing = await db.products.get(input.id);
    if (!existing) throw new Error("Product not found");
    const next: Product = {
      ...existing,
      sku: input.sku,
      barcode: input.barcode,
      name: input.name,
      description: input.description,
      brand: input.brand,
      category_id: input.category_id,
      default_supplier_id: input.default_supplier_id,
      unit: input.unit ?? existing.unit,
      // null = photo explicitly removed; undefined = untouched.
      image_data:
        input.image_data === undefined ? existing.image_data : input.image_data || undefined,
      images:
        input.images === undefined
          ? existing.images
          : input.images && input.images.length > 0
            ? input.images
            : undefined,
      sell_price,
      tax_rate,
      reorder_point: cleanReorder(input.reorder_point),
      reorder_qty: cleanReorder(input.reorder_qty),
      updated_at: now,
    };
    await db.products.put(next);
    await enqueue("product", "upsert", next);
    return next.id;
  }
  const product: Product = {
    id: newId(),
    sku: input.sku,
    barcode: input.barcode,
    name: input.name,
    description: input.description,
    brand: input.brand,
    category_id: input.category_id,
    default_supplier_id: input.default_supplier_id,
    unit: input.unit ?? "pc",
    image_data: input.image_data || undefined,
    images: input.images && input.images.length > 0 ? input.images : undefined,
    sell_price,
    tax_rate,
    avg_cost: 0,
    quantity_on_hand: 0,
    reorder_point: cleanReorder(input.reorder_point),
    reorder_qty: cleanReorder(input.reorder_qty),
    is_archived: false,
    created_at: now,
    updated_at: now,
  };
  await db.products.put(product);
  await enqueue("product", "upsert", product);
  return product.id;
}

export async function archiveProduct(id: string, archived = true): Promise<void> {
  const existing = await db.products.get(id);
  if (!existing) return;
  const next = { ...existing, is_archived: archived, updated_at: nowIso() };
  await db.products.put(next);
  await enqueue("product", "upsert", next);
}

export async function findByBarcode(barcode: string): Promise<Product | undefined> {
  return db.products.where("barcode").equals(barcode).first();
}

/**
 * Scan/manual-entry lookup: try barcode first, then SKU (case-insensitive) —
 * the manual input is labelled "barcode / SKU".
 */
export async function findByCode(code: string): Promise<Product | undefined> {
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  const byBarcode = await db.products.where("barcode").equals(trimmed).first();
  if (byBarcode) return byBarcode;
  const needle = trimmed.toLowerCase();
  return (await db.products.toArray()).find((p) => p.sku?.trim().toLowerCase() === needle);
}

// ---------- Movements (the ledger) ----------

export interface MovementInput {
  product_id: string;
  type: MovementType;
  quantity: number; // magnitude for in/out; signed for adjustment
  unit_cost?: number;
  unit_price?: number;
  supplier_id?: string;
  customer_id?: string;
  order_id?: string;
  reference?: string;
  note?: string;
  occurred_at?: string;
}

/** Records a movement and returns the fully-computed ledger row (with cogs/tax). */
export async function recordMovement(input: MovementInput): Promise<StockMovement> {
  const profile = await ensureProfile();
  if (!Number.isFinite(input.quantity) || Math.trunc(input.quantity) === 0) {
    throw new Error("Quantity must be a whole number other than zero");
  }
  cleanMoney(input.unit_cost, "Unit cost");
  cleanMoney(input.unit_price, "Unit price");
  return db.transaction("rw", db.products, db.movements, db.outbox, async () => {
    const product = await db.products.get(input.product_id);
    if (!product) throw new Error("Product not found");

    const { nextProduct, movement } = applyMovement(product, profile, {
      client_id: newId(),
      id: newId(),
      type: input.type,
      quantity: input.quantity,
      unit_cost: input.unit_cost,
      unit_price: input.unit_price,
      supplier_id: input.supplier_id,
      customer_id: input.customer_id,
      order_id: input.order_id,
      reference: input.reference,
      note: input.note,
      occurred_at: input.occurred_at ?? nowIso(),
    });

    await db.movements.put(movement);
    await db.products.put(nextProduct);
    await enqueue("movement", "insert", movement);
    await enqueue("product", "upsert", nextProduct);
    return movement;
  });
}

// ---------- Lookups: categories / suppliers / customers ----------

/** Throw when another row in the table already has this (trimmed, case-insensitive) name. */
async function assertUniqueName(
  table: "categories" | "suppliers" | "customers",
  name: string,
  selfId?: string
): Promise<void> {
  const needle = name.trim().toLowerCase();
  const clash = (await db.table(table).toArray()).find(
    (r: { id: string; name: string }) =>
      r.id !== selfId && r.name.trim().toLowerCase() === needle
  );
  if (clash) throw new Error(`"${clash.name}" already exists`);
}

export async function saveCategory(name: string, id?: string): Promise<string> {
  const now = nowIso();
  await assertUniqueName("categories", name, id);
  const row: Category = id
    ? { ...(await db.categories.get(id))!, name, updated_at: now }
    : { id: newId(), name, created_at: now, updated_at: now };
  await db.categories.put(row);
  await enqueue("category", "upsert", row);
  return row.id;
}

export async function saveSupplier(
  data: { id?: string; name: string; contact?: string }
): Promise<string> {
  const now = nowIso();
  await assertUniqueName("suppliers", data.name, data.id);
  const row: Supplier = data.id
    ? { ...(await db.suppliers.get(data.id))!, name: data.name, contact: data.contact, updated_at: now }
    : { id: newId(), name: data.name, contact: data.contact, created_at: now, updated_at: now };
  await db.suppliers.put(row);
  await enqueue("supplier", "upsert", row);
  return row.id;
}

export async function saveCustomer(
  data: { id?: string; name: string; contact?: string; note?: string }
): Promise<string> {
  const now = nowIso();
  await assertUniqueName("customers", data.name, data.id);
  const row: Customer = data.id
    ? {
        ...(await db.customers.get(data.id))!,
        name: data.name,
        contact: data.contact,
        note: data.note,
        updated_at: now,
      }
    : {
        id: newId(),
        name: data.name,
        contact: data.contact,
        note: data.note,
        created_at: now,
        updated_at: now,
      };
  await db.customers.put(row);
  await enqueue("customer", "upsert", row);
  return row.id;
}

/** Delete a category; products pointing at it fall back to "no category". */
export async function deleteCategory(id: string): Promise<void> {
  await db.transaction("rw", db.categories, db.products, db.outbox, async () => {
    const affected = await db.products.where("category_id").equals(id).toArray();
    for (const p of affected) {
      const next = { ...p, category_id: undefined, updated_at: nowIso() };
      await db.products.put(next);
      await enqueue("product", "upsert", next);
    }
    await db.categories.delete(id);
    await enqueue("category", "delete", { id });
  });
}

/** Delete a supplier; products' default supplier is cleared (ledger rows keep their historical id). */
export async function deleteSupplier(id: string): Promise<void> {
  await db.transaction("rw", db.suppliers, db.products, db.outbox, async () => {
    const affected = await db.products.where("default_supplier_id").equals(id).toArray();
    for (const p of affected) {
      const next = { ...p, default_supplier_id: undefined, updated_at: nowIso() };
      await db.products.put(next);
      await enqueue("product", "upsert", next);
    }
    await db.suppliers.delete(id);
    await enqueue("supplier", "delete", { id });
  });
}

/** Delete a customer — blocked while they still have orders, invoices or sales history. */
export async function deleteCustomer(id: string): Promise<void> {
  const [orders, invoices, sales] = await Promise.all([
    db.orders.where("customer_id").equals(id).count(),
    db.invoices.where("customer_id").equals(id).count(),
    db.movements.where("customer_id").equals(id).count(),
  ]);
  if (orders + invoices + sales > 0) {
    throw new Error("This customer has orders, invoices or sales history and can't be deleted");
  }
  await db.customers.delete(id);
  await enqueue("customer", "delete", { id });
}

// ---------- Stocktake / recount sessions ----------

/** Start a new count session seeded with all active products at their current on-hand. */
export async function createStockCount(note?: string): Promise<string> {
  const now = nowIso();
  const count: StockCount = {
    id: newId(),
    note,
    status: "open",
    created_at: now,
    updated_at: now,
  };
  const products = (await db.products.toArray()).filter((p) => !p.is_archived);
  const items: StockCountItem[] = products.map((p) => ({
    id: newId(),
    count_id: count.id,
    product_id: p.id,
    expected_qty: p.quantity_on_hand,
    counted_qty: null,
    updated_at: now,
  }));
  await db.transaction("rw", db.stockCounts, db.stockCountItems, db.outbox, async () => {
    await db.stockCounts.put(count);
    await db.stockCountItems.bulkPut(items);
    await enqueue("stock_count", "upsert", count);
  });
  return count.id;
}

export async function setCountItem(itemId: string, countedQty: number | null): Promise<void> {
  const item = await db.stockCountItems.get(itemId);
  if (!item) return;
  // A physical count can never be negative or fractional.
  const cleaned = countedQty == null ? null : Math.max(0, Math.trunc(countedQty));
  const next: StockCountItem = { ...item, counted_qty: cleaned, updated_at: nowIso() };
  await db.stockCountItems.put(next);
  await enqueue("stock_count_item", "upsert", next);
}

export async function deleteStockCount(countId: string): Promise<void> {
  await db.transaction("rw", db.stockCounts, db.stockCountItems, db.outbox, async () => {
    await db.stockCountItems.where("count_id").equals(countId).delete();
    await db.stockCounts.delete(countId);
    // Server-side ON DELETE CASCADE removes the items with the header.
    await enqueue("stock_count", "delete", { id: countId });
  });
}

/**
 * Commit a count: every counted line whose value differs from current on-hand
 * generates an `adjustment` movement for the variance. Idempotent-ish: a committed
 * count can't be committed again.
 * Returns the number of variance adjustments created.
 */
export async function commitStockCount(countId: string): Promise<number> {
  const count = await db.stockCounts.get(countId);
  if (!count || count.status === "committed") return 0;
  const items = await db.stockCountItems.where("count_id").equals(countId).toArray();

  let adjustments = 0;
  for (const item of items) {
    if (item.counted_qty == null) continue;
    const product = await db.products.get(item.product_id);
    if (!product) continue;
    const variance = item.counted_qty - product.quantity_on_hand;
    if (variance === 0) continue;
    await recordMovement({
      product_id: product.id,
      type: "adjustment",
      quantity: variance, // signed
      note: `Stocktake ${count.note ? `(${count.note}) ` : ""}variance`,
    });
    adjustments++;
  }

  const now = nowIso();
  const committed: StockCount = { ...count, status: "committed", committed_at: now, updated_at: now };
  await db.stockCounts.put(committed);
  await enqueue("stock_count", "upsert", committed);
  return adjustments;
}

// ---------- Orders (multi-line sales) ----------

export interface OrderTotals {
  subtotal: number;
  tax_total: number;
  total: number;
}

/** Pure: compute subtotal (ex-tax), tax and gross total for a set of order lines. */
export function computeOrderTotals(items: OrderItem[], profile: Profile): OrderTotals {
  let subtotal = 0;
  let tax_total = 0;
  let total = 0;
  for (const it of items) {
    const rate = it.tax_rate ?? 0;
    const lineTotal = it.quantity * it.unit_price;
    const tax = taxFromLineTotal(lineTotal, rate, profile.prices_tax_inclusive);
    tax_total += tax;
    if (profile.prices_tax_inclusive) {
      total += lineTotal;
      subtotal += lineTotal - tax;
    } else {
      subtotal += lineTotal;
      total += lineTotal + tax;
    }
  }
  return { subtotal: round2(subtotal), tax_total: round2(tax_total), total: round2(total) };
}

/** Read the order, asserting it is still an editable draft. */
async function requireDraftOrder(orderId: string): Promise<Order> {
  const order = await db.orders.get(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "draft") throw new Error("Only draft orders can be edited");
  return order;
}

/** Recompute and persist an order's totals from its current lines. */
async function persistOrderTotals(orderId: string, profile: Profile): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) return;
  const items = await db.orderItems.where("order_id").equals(orderId).toArray();
  const totals = computeOrderTotals(items, profile);
  const next: Order = { ...order, ...totals, updated_at: nowIso() };
  await db.orders.put(next);
  await enqueue("order", "upsert", next);
}

export async function createDraftOrder(customerId?: string): Promise<string> {
  return db.transaction("rw", db.orders, db.counters, db.outbox, async () => {
    const now = nowIso();
    const order: Order = {
      id: newId(),
      order_no: await nextNumber("order", "ORD"),
      customer_id: customerId || undefined,
      status: "draft",
      subtotal: 0,
      tax_total: 0,
      total: 0,
      occurred_at: now,
      created_at: now,
      updated_at: now,
    };
    await db.orders.put(order);
    await enqueue("order", "upsert", order);
    return order.id;
  });
}

export async function setOrderCustomer(orderId: string, customerId?: string): Promise<void> {
  await db.transaction("rw", db.orders, db.outbox, async () => {
    const order = await requireDraftOrder(orderId);
    const next: Order = { ...order, customer_id: customerId || undefined, updated_at: nowIso() };
    await db.orders.put(next);
    await enqueue("order", "upsert", next);
  });
}

/** Backdate a draft order's business date (flows to its sale movements at confirm). */
export async function setOrderDate(orderId: string, occurredAt: string): Promise<void> {
  await db.transaction("rw", db.orders, db.outbox, async () => {
    const order = await requireDraftOrder(orderId);
    const next: Order = { ...order, occurred_at: occurredAt, updated_at: nowIso() };
    await db.orders.put(next);
    await enqueue("order", "upsert", next);
  });
}

export async function setOrderNote(orderId: string, note?: string): Promise<void> {
  await db.transaction("rw", db.orders, db.outbox, async () => {
    const order = await requireDraftOrder(orderId);
    const next: Order = { ...order, note: note || undefined, updated_at: nowIso() };
    await db.orders.put(next);
    await enqueue("order", "upsert", next);
  });
}

export async function addOrderItem(
  orderId: string,
  input: { product_id: string; quantity?: number; unit_price?: number }
): Promise<void> {
  const profile = await ensureProfile();
  await db.transaction("rw", db.orders, db.orderItems, db.products, db.outbox, async () => {
    await requireDraftOrder(orderId);
    const product = await db.products.get(input.product_id);
    if (!product) throw new Error("Product not found");
    const now = nowIso();
    const lines = await db.orderItems.where("order_id").equals(orderId).toArray();
    const existing = lines.find((l) => l.product_id === input.product_id);
    const qty = Math.max(1, Math.trunc(input.quantity ?? 1));
    const item: OrderItem = existing
      ? { ...existing, quantity: existing.quantity + qty, updated_at: now }
      : {
          id: newId(),
          order_id: orderId,
          product_id: product.id,
          quantity: qty,
          unit_price: cleanMoney(input.unit_price, "Unit price") ?? product.sell_price ?? 0,
          tax_rate: effectiveTaxRate(product, profile),
          updated_at: now,
        };
    await db.orderItems.put(item);
    await enqueue("order_item", "upsert", item);
    await persistOrderTotals(orderId, profile);
  });
}

export async function updateOrderItem(
  itemId: string,
  patch: { quantity?: number; unit_price?: number }
): Promise<void> {
  const profile = await ensureProfile();
  await db.transaction("rw", db.orders, db.orderItems, db.outbox, async () => {
    const item = await db.orderItems.get(itemId);
    if (!item) throw new Error("Line not found");
    await requireDraftOrder(item.order_id);
    const next: OrderItem = {
      ...item,
      quantity: patch.quantity != null ? Math.max(1, Math.trunc(patch.quantity)) : item.quantity,
      unit_price:
        patch.unit_price != null
          ? cleanMoney(patch.unit_price, "Unit price") ?? item.unit_price
          : item.unit_price,
      updated_at: nowIso(),
    };
    await db.orderItems.put(next);
    await enqueue("order_item", "upsert", next);
    await persistOrderTotals(item.order_id, profile);
  });
}

export async function removeOrderItem(itemId: string): Promise<void> {
  const profile = await ensureProfile();
  await db.transaction("rw", db.orders, db.orderItems, db.outbox, async () => {
    const item = await db.orderItems.get(itemId);
    if (!item) return;
    await requireDraftOrder(item.order_id);
    await db.orderItems.delete(itemId);
    // The line was already pushed when it was added — remove it server-side too.
    await enqueue("order_item", "delete", { id: itemId });
    await persistOrderTotals(item.order_id, profile);
  });
}

export async function deleteDraftOrder(orderId: string): Promise<void> {
  await db.transaction("rw", db.orders, db.orderItems, db.outbox, async () => {
    const order = await db.orders.get(orderId);
    if (!order) return;
    if (order.status !== "draft") throw new Error("Only draft orders can be deleted");
    await db.orderItems.where("order_id").equals(orderId).delete();
    await db.orders.delete(orderId);
    // Server-side ON DELETE CASCADE removes the lines with the order.
    await enqueue("order", "delete", { id: orderId });
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function deriveInvoiceStatus(amountPaid: number, total: number): InvoiceStatus {
  if (amountPaid >= total) return "paid";
  if (amountPaid > 0) return "partial";
  return "unpaid";
}

/**
 * Confirm a draft order: post one `sale` movement per line (reusing recordMovement
 * so AVCO/COGS/tax/stock all stay correct), snapshot totals, and auto-create the
 * invoice. Returns the confirmed order and its invoice.
 */
export async function confirmOrder(orderId: string): Promise<{ order: Order; invoice: Invoice }> {
  const profile = await ensureProfile();
  return db.transaction(
    "rw",
    [db.orders, db.orderItems, db.products, db.movements, db.invoices, db.counters, db.profiles, db.outbox],
    async () => {
      const order = await db.orders.get(orderId);
      if (!order) throw new Error("Order not found");
      if (order.status !== "draft") throw new Error("Only draft orders can be confirmed");
      const items = await db.orderItems.where("order_id").equals(orderId).toArray();
      if (items.length === 0) throw new Error("Add at least one item before confirming");

      for (const it of items) {
        const movement = await recordMovement({
          product_id: it.product_id,
          type: "sale",
          quantity: it.quantity,
          unit_price: it.unit_price,
          customer_id: order.customer_id,
          order_id: order.id,
          reference: order.order_no,
          occurred_at: order.occurred_at,
        });
        const nextItem: OrderItem = {
          ...it,
          cogs_unit: movement.cogs_unit,
          movement_id: movement.id,
          updated_at: nowIso(),
        };
        await db.orderItems.put(nextItem);
        await enqueue("order_item", "upsert", nextItem);
      }

      const totals = computeOrderTotals(items, profile);
      const now = nowIso();
      const confirmed: Order = {
        ...order,
        ...totals,
        status: "confirmed",
        confirmed_at: now,
        updated_at: now,
      };
      await db.orders.put(confirmed);
      await enqueue("order", "upsert", confirmed);

      const invoice: Invoice = {
        id: newId(),
        invoice_no: await nextNumber("invoice", "INV"),
        order_id: confirmed.id,
        customer_id: confirmed.customer_id,
        status: confirmed.total > 0 ? "unpaid" : "paid",
        subtotal: confirmed.subtotal,
        tax_total: confirmed.tax_total,
        total: confirmed.total,
        amount_paid: 0,
        issued_at: now,
        due_at: profile.invoice_due_days > 0 ? addDays(now, profile.invoice_due_days) : now,
        created_at: now,
        updated_at: now,
      };
      await db.invoices.put(invoice);
      await enqueue("invoice", "upsert", invoice);
      return { order: confirmed, invoice };
    }
  );
}

/**
 * Cancel a confirmed order: post a `return_in` movement per line at its captured
 * cost (restoring stock at original cost), mark the order cancelled and void its
 * invoice.
 */
export async function cancelOrder(orderId: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.orders, db.orderItems, db.products, db.movements, db.invoices, db.profiles, db.outbox],
    async () => {
      const order = await db.orders.get(orderId);
      if (!order) throw new Error("Order not found");
      if (order.status === "cancelled") return;
      if (order.status !== "confirmed") throw new Error("Only confirmed orders can be cancelled");
      // Received money must be dealt with first — voiding would orphan the payments.
      const orderInvoices = await db.invoices.where("order_id").equals(orderId).toArray();
      if (orderInvoices.some((inv) => inv.status !== "void" && inv.amount_paid > 0)) {
        throw new Error(
          "This order's invoice has recorded payments. Remove or refund them before cancelling."
        );
      }
      const items = await db.orderItems.where("order_id").equals(orderId).toArray();

      for (const it of items) {
        await recordMovement({
          product_id: it.product_id,
          type: "return_in",
          quantity: it.quantity,
          unit_cost: it.cogs_unit,
          customer_id: order.customer_id,
          order_id: order.id,
          reference: order.order_no,
          note: "Order cancelled",
        });
      }

      const now = nowIso();
      await db.orders.put({ ...order, status: "cancelled", updated_at: now });
      await enqueue("order", "upsert", { ...order, status: "cancelled", updated_at: now });

      const invoices = await db.invoices.where("order_id").equals(orderId).toArray();
      for (const inv of invoices) {
        if (inv.status === "void") continue;
        const voided: Invoice = { ...inv, status: "void", updated_at: now };
        await db.invoices.put(voided);
        await enqueue("invoice", "upsert", voided);
      }
    }
  );
}

// ---------- Invoices & payments (accounts receivable) ----------

export async function recordPayment(
  invoiceId: string,
  data: { amount: number; method?: string; note?: string; paid_at?: string }
): Promise<Invoice> {
  return db.transaction("rw", db.invoices, db.payments, db.outbox, async () => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "void") throw new Error("Cannot pay a void invoice");
    const amount = round2(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Payment amount must be positive");
    const balance = round2(invoice.total - invoice.amount_paid);
    if (amount > balance) {
      throw new Error(
        `Payment exceeds the balance due (${balance.toFixed(2)}). Record at most the outstanding amount.`
      );
    }
    const now = nowIso();
    const payment: Payment = {
      id: newId(),
      invoice_id: invoiceId,
      amount,
      method: data.method || undefined,
      note: data.note || undefined,
      paid_at: data.paid_at ?? now,
      created_at: now,
    };
    await db.payments.put(payment);
    await enqueue("payment", "insert", payment);

    const amount_paid = round2(invoice.amount_paid + amount);
    const next: Invoice = {
      ...invoice,
      amount_paid,
      status: deriveInvoiceStatus(amount_paid, invoice.total),
      updated_at: now,
    };
    await db.invoices.put(next);
    await enqueue("invoice", "upsert", next);
    return next;
  });
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await db.transaction("rw", db.invoices, db.outbox, async () => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) return;
    if (invoice.status === "void") return;
    // Voiding an invoice with received money would make the cash trail vanish
    // from A/R — the payments must be dealt with first.
    if (invoice.amount_paid > 0) {
      throw new Error("This invoice has recorded payments and can't be voided.");
    }
    const next: Invoice = { ...invoice, status: "void", updated_at: nowIso() };
    await db.invoices.put(next);
    await enqueue("invoice", "upsert", next);
  });
}
