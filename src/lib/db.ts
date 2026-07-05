import Dexie, { type Table } from "dexie";
import type {
  Category,
  Counter,
  Customer,
  Invoice,
  Meta,
  Order,
  OrderItem,
  OutboxEntry,
  Payment,
  Product,
  Profile,
  StockCount,
  StockCountItem,
  StockMovement,
  Supplier,
} from "./types";

export const PROFILE_ID = "local";

export class StockDeskDB extends Dexie {
  profiles!: Table<Profile, string>;
  products!: Table<Product, string>;
  movements!: Table<StockMovement, string>;
  categories!: Table<Category, string>;
  suppliers!: Table<Supplier, string>;
  customers!: Table<Customer, string>;
  stockCounts!: Table<StockCount, string>;
  stockCountItems!: Table<StockCountItem, string>;
  orders!: Table<Order, string>;
  orderItems!: Table<OrderItem, string>;
  invoices!: Table<Invoice, string>;
  payments!: Table<Payment, string>;
  counters!: Table<Counter, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super("stockdesk");
    this.version(1).stores({
      profiles: "id",
      products: "id, name, barcode, sku, category_id, is_archived, updated_at",
      movements: "id, client_id, product_id, type, occurred_at, created_at",
      categories: "id, name, updated_at",
      suppliers: "id, name, updated_at",
      customers: "id, name, updated_at",
      outbox: "id, entity, created_at",
    });
    this.version(2).stores({
      stockCounts: "id, status, created_at",
      stockCountItems: "id, count_id, product_id",
    });
    // v3: customer-management — orders, invoices, payments. Re-declare `movements`
    // to add order_id/customer_id indexes for per-customer / per-order queries.
    this.version(3).stores({
      movements:
        "id, client_id, product_id, type, occurred_at, created_at, customer_id, order_id",
      orders: "id, order_no, customer_id, status, occurred_at, updated_at",
      orderItems: "id, order_id, product_id",
      invoices: "id, invoice_no, order_id, customer_id, status, issued_at, due_at, updated_at",
      payments: "id, invoice_id, paid_at",
      counters: "id",
    });
    // v4: sync hardening — `meta` bookkeeping store (last pull, owner binding,
    // onboarding flag) + a monotonic `seq` index on the outbox for strict FIFO.
    this.version(4)
      .stores({
        meta: "key",
        outbox: "id, entity, created_at, seq",
      })
      .upgrade(async (tx) => {
        // Backfill seq on old entries preserving created_at order.
        const entries = await tx.table("outbox").orderBy("created_at").toArray();
        let seq = 1;
        for (const e of entries) {
          await tx.table("outbox").update(e.id, { seq: seq++ });
        }
      });
  }
}

export const db = new StockDeskDB();

// ---------- Meta (key/value bookkeeping) ----------

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key);
}

export const DEFAULT_PROFILE: Profile = {
  id: PROFILE_ID,
  display_name: "My Store",
  currency: "USD",
  low_stock_default: 5,
  tax_label: "VAT",
  default_tax_rate: 0,
  prices_tax_inclusive: true,
  invoice_due_days: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** Ensure a profile row exists; returns it. Safe to call repeatedly. */
export async function ensureProfile(): Promise<Profile> {
  const existing = await db.profiles.get(PROFILE_ID);
  if (existing) return existing;
  await db.profiles.put(DEFAULT_PROFILE);
  return DEFAULT_PROFILE;
}

/**
 * Allocate the next sequential, zero-padded human number for a counter (e.g.
 * "ORD-0001"). Must be called inside a `rw` transaction that includes `counters`
 * so the read-increment-write is atomic. Safe for the single offline user.
 */
export async function nextNumber(kind: Counter["id"], prefix: string): Promise<string> {
  const row = await db.counters.get(kind);
  const next = (row?.next ?? 1);
  await db.counters.put({ id: kind, next: next + 1 });
  return `${prefix}-${String(next).padStart(4, "0")}`;
}
