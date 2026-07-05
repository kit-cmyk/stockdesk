// Core domain types for StockDesk. Mirrors the SSOT database schema.
// All quantities are whole integers (whole units only).

export type MovementType =
  | "opening"
  | "purchase"
  | "sale"
  | "adjustment"
  | "return_in"
  | "return_out"
  | "loss";

export const INBOUND_TYPES: MovementType[] = ["opening", "purchase", "return_in"];
export const OUTBOUND_TYPES: MovementType[] = ["sale", "return_out", "loss"];

export interface Profile {
  id: string; // singleton "local" until cloud auth assigns a user id
  display_name: string;
  owner_name?: string; // the person using the app (profile settings)
  avatar_data?: string; // profile photo — data URL, device-local (never synced)
  currency: string; // ISO 4217
  low_stock_default: number;
  tax_label: string; // e.g. "VAT", "GST", "Sales Tax"
  default_tax_rate: number; // percent
  prices_tax_inclusive: boolean;
  business_address?: string; // shown on the invoice document header
  tax_number?: string; // tax/VAT registration no. on invoices
  invoice_due_days: number; // default payment terms; 0 = due on issue (cash)
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  contact?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  category_id?: string;
  default_supplier_id?: string;
  unit: string; // pc, box, ...
  image_data?: string; // thumbnail photo — local data URL (MVP); image_path in cloud
  images?: string[]; // all photos (data URLs, device-local); includes the thumbnail
  sell_price?: number; // tax-inclusive per profile flag
  tax_rate?: number; // per-product override; undefined -> profile default
  avg_cost: number; // moving weighted average, ex-tax (maintained on write)
  quantity_on_hand: number; // denormalized (maintained on write)
  reorder_point?: number;
  reorder_qty?: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  client_id: string; // idempotency key
  product_id: string;
  type: MovementType;
  quantity_delta: number; // signed: + in, - out (whole units)
  unit_cost?: number; // ex-tax cost/unit for inbound
  unit_price?: number; // sale price/unit (gross or net per profile flag)
  tax_rate?: number; // snapshot of applied rate
  tax_amount?: number; // line tax (output on sales, input on purchases)
  tax_inclusive?: boolean; // snapshot of profile.prices_tax_inclusive at sale time (missing = inclusive)
  cogs_unit?: number; // captured ex-tax avg_cost at sale time
  supplier_id?: string;
  customer_id?: string;
  order_id?: string; // set when this sale was posted by confirming an order
  reference?: string;
  note?: string;
  occurred_at: string; // business date
  created_at: string; // device insert time
}

// Orders — a multi-line sale (cart/checkout) for one customer.
export type OrderStatus = "draft" | "confirmed" | "cancelled";

export interface Order {
  id: string;
  order_no: string; // human ref e.g. "ORD-0001"
  customer_id?: string; // optional (walk-in)
  status: OrderStatus;
  subtotal: number; // ex-tax (live while draft, snapshot on confirm)
  tax_total: number;
  total: number; // gross
  note?: string;
  occurred_at: string; // business date
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number; // whole units
  unit_price: number; // gross/net per profile flag (snapshot)
  tax_rate?: number; // snapshot of applied rate
  cogs_unit?: number; // captured at confirm from the posted sale movement
  movement_id?: string; // links line -> posted sale movement after confirm
  updated_at: string;
}

// Invoices — accounts-receivable document generated from a confirmed order.
export type InvoiceStatus = "unpaid" | "partial" | "paid" | "void";

export interface Invoice {
  id: string;
  invoice_no: string; // "INV-0001"
  order_id: string;
  customer_id?: string;
  status: InvoiceStatus;
  subtotal: number; // snapshot from order
  tax_total: number;
  total: number;
  amount_paid: number; // sum of payments (maintained on write)
  issued_at: string;
  due_at?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method?: string; // cash/card/transfer (free text)
  note?: string;
  paid_at: string;
  created_at: string;
}

// Monotonic counters for human-friendly sequential numbering (offline-safe, single user).
export interface Counter {
  id: "order" | "invoice";
  next: number;
}

// Stocktake / physical recount sessions
export type StockCountStatus = "open" | "committed";

export interface StockCount {
  id: string;
  note?: string;
  status: StockCountStatus;
  created_at: string;
  committed_at?: string;
  updated_at: string;
}

export interface StockCountItem {
  id: string;
  count_id: string;
  product_id: string;
  expected_qty: number; // on-hand snapshot when the line was added
  counted_qty: number | null; // null = not yet counted
  updated_at: string;
}

// Sync outbox entry
export interface OutboxEntry {
  id: string; // == client_id of the mutation
  entity:
    | "product"
    | "movement"
    | "category"
    | "supplier"
    | "customer"
    | "profile"
    | "stock_count"
    | "stock_count_item"
    | "order"
    | "order_item"
    | "invoice"
    | "payment";
  op: "upsert" | "insert" | "delete";
  payload: unknown;
  created_at: string;
  /** Monotonic sequence for strict FIFO flushing (created_at can tie within a ms). */
  seq: number;
  attempts: number;
  last_error?: string;
  /** Set when the server rejected the entry with a non-retryable error (bad data, constraint). */
  permanent?: boolean;
}

/** Small key/value store for sync bookkeeping (last pull time, owner binding, onboarding). */
export interface Meta {
  key: string;
  value: string;
}
