# StockDesk — Single Source of Truth (SSOT)

> Mobile-first, offline-first Progressive Web App for inventory management of products you buy and sell.
> This document is the canonical plan. Every design, schema, and UX decision lives here. Update this file before changing the build.

- **Status:** Planning / pre-build
- **Created:** 2026-06-24
- **Owner:** Kit (kit@assembledsystems.com)
- **Version:** 0.1 (plan)

---

## 0. Locked Decisions

| Decision | Choice | Why |
|---|---|---|
| Users | **Solo** (single account) | One operator today. Schema includes a tenant boundary so team/multi-location can be added later with zero data migration. |
| Connectivity | **Offline-first** | Record stock in stockrooms with no signal; sync when back online. |
| Input | **Barcode scanning** + manual entry | Fast stock in/out and product lookup via phone camera. Sales entered manually. |
| Hosting | **Supabase + Vercel (free tiers)** | $0 to start, scales when needed, managed Postgres + Auth + Storage. |
| Costing method | **Moving weighted average (AVCO)** | Accurate enough for a solo seller, simple to compute, gives true earnings-per-item. Schema preserves per-movement cost so FIFO can be added later. |
| Currency | **Single currency** | One ISO currency set in profile; no FX. |
| Units | **Whole units only** | Quantities are integers (`pc`, `box`…); no fractional/decimal stock. |
| Tax/VAT | **Tracked from MVP** | Per-sale tax rate + amount, input tax on purchases, net VAT reporting. Profit is computed on **net (ex-tax)** revenue. |
| Customers | **Full customer management** | `customers` hub + multi-line **orders** (cart/checkout) + **invoices** with accounts-receivable (payments, balances, due dates) and a printable invoice document. Orders post sale movements per line; the ledger stays the source of truth. |

---

## 1. Idea Validation

### Problem statement
A small/solo seller needs to know — at a glance, from their phone, even in a stockroom with no signal — what they have, what it cost, what it's selling for, and whether each product actually makes money. Spreadsheets break down on mobile, don't handle stock movements as a ledger, and never tell you profit per item or when to reorder.

### Value proposition
StockDesk turns a phone into a barcode-driven stock terminal: scan to receive, scan to sell, and instantly see cost per item, earnings per item, margin, stock on hand, and reorder alerts — online or offline.

### Target user
The owner-operator of a small product business (reseller, market trader, boutique, craft/maker, mini-warehouse) who manages 20–2,000 SKUs themselves and currently uses a spreadsheet or nothing.

### Assumptions to validate
| Assumption | How to validate | Risk if wrong |
|---|---|---|
| Barcode scanning on a phone is fast/reliable enough for daily use | Prototype the scanner early; test in poor light | Core input flow is frustrating → low adoption |
| Moving-average costing matches how the user thinks about profit | Confirm with user on first real data set | Reported earnings feel "wrong" → distrust |
| Offline edits rarely conflict (one user) | Conflict design assumes last-write-wins per field is acceptable | Lost edits if assumption breaks |

### Go / No-Go
- **Strengths:** Narrow, real pain; clear daily-use loop (scan → move → see profit); $0 infra; PWA avoids app-store friction.
- **Risks:** Scanner UX; offline-sync correctness; scope creep into full accounting.
- **Red flags:** None blocking.
- **Verdict: GO** — build the MVP loop (catalog → receive → sell → profit/reorder) first.

### Recommended next step
Build **Phase A (MVP)** per the roadmap in §11.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js (App Router) + React + TypeScript** | First-class PWA support, file-based routing, deploys free to Vercel, great mobile DX. |
| UI | **Tailwind CSS + shadcn/ui** | Fast, consistent, mobile-first; accessible primitives. |
| State / data | **TanStack Query** + **Zustand** (UI state) | Query caching maps cleanly onto offline cache + background sync. |
| Offline storage | **IndexedDB via Dexie.js** | Durable local DB for the outbox queue and cached reads. |
| Service worker / PWA | **Serwist** (next-gen Workbox for Next.js) | Precaching, runtime caching, background sync registration. |
| Barcode scanning | **@zxing/browser** (camera) + manual entry fallback | Pure-web, no native dependency; supports EAN/UPC/Code128/QR. |
| Backend | **Supabase** (Postgres + PostgREST + Auth + Storage + Edge Functions) | Managed Postgres with row-level security; auto REST/Realtime; free tier. |
| Auth | **Supabase Auth** (email magic link + password) | Built in; RLS ties every row to the owner. |
| Hosting | **Vercel** (frontend) + **Supabase** (data) | Both free to start; CI from GitHub. |
| CI/CD | **GitHub Actions** → Vercel preview/prod | Lint, typecheck, test, build, deploy. |
| Charts | **Recharts** | Lightweight, responsive dashboards. |
| Error/monitoring | **Sentry** (free) + Vercel Analytics | Catch client + edge errors. |

### Alternatives considered
| Option | Reason not chosen |
|---|---|
| Native app (React Native / Flutter) | App-store friction; PWA meets offline + camera needs. |
| Firebase | Postgres + RLS + SQL analytics fit inventory math better than Firestore. |
| Plain CRA/Vite SPA | Lose Next.js PWA + edge + image tooling and easy Vercel deploy. |
| Full custom Node API | Supabase/PostgREST removes most backend boilerplate for a solo build. |

### Risks & mitigations
| Risk | Mitigation |
|---|---|
| Offline sync bugs | Append-only movement ledger + idempotency keys + last-write-wins on editable entities (§7). |
| Supabase free-tier limits / project pausing | Keep payloads small; export/backup job; upgrade path is one click. |
| Costing edge cases (returns, negative stock) | Defined rules in §6; guard rails in DB functions. |

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         PHONE (PWA)                            │
│  Next.js UI ── TanStack Query ── Dexie (IndexedDB)            │
│       │                │                  │                    │
│   Camera/ZXing     read cache         Outbox queue            │
│       │                │                  │                    │
│            Service Worker (Serwist): precache + bg sync        │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS (when online)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                        SUPABASE                               │
│  Auth (JWT)  →  PostgREST API  →  Postgres (RLS per owner)    │
│                          │                                     │
│         DB functions/triggers: stock balance, AVCO,           │
│         COGS capture, low-stock flags                          │
│  Storage (product images)   Edge Functions (sync, reports)   │
└──────────────────────────────────────────────────────────────┘
```

### Components
| Component | Tech | Responsibility |
|---|---|---|
| PWA shell | Next.js + Serwist | App UI, install, offline cache, routing. |
| Local DB | Dexie/IndexedDB | Cached reads + **outbox** of pending mutations. |
| Sync engine | Custom hook + Background Sync | Flush outbox to Supabase in order with idempotency keys; pull deltas. |
| Scanner | ZXing | Decode barcodes from camera; map to product or prefill new product. |
| Data API | Supabase PostgREST | CRUD with RLS; bulk endpoints for sync. |
| DB logic | Postgres functions/triggers | Maintain `quantity_on_hand`, `avg_cost`, capture COGS, set low-stock. |
| Auth | Supabase Auth | Owns identity; `owner_id` on every row. |
| Storage | Supabase Storage | Product photos. |

### Data flow — "Sell 2 units by scanning"
1. User scans barcode → app finds product in **local cache**.
2. User confirms qty=2 and sale price → app writes a `stock_movements` record (type `sale`) to the **outbox** with a `client_id` (UUID) and optimistically updates on-hand locally.
3. Service worker Background Sync (or immediate, if online) POSTs the movement to Supabase.
4. DB trigger decrements `quantity_on_hand`, captures `cogs_unit = product.avg_cost`, computes earnings, flags low-stock.
5. On success the outbox row is marked synced; on conflict (duplicate `client_id`) the server ignores it idempotently.

### Security model
- **Auth:** Supabase JWT. Every table carries `owner_id`; **RLS** restricts all rows to `auth.uid()`.
- **Data sensitivity:** Business/financial data — private to the owner. No PII beyond the account email.
- **Attack surface:** PostgREST endpoints (protected by RLS), Storage (signed URLs, owner-scoped), Edge Functions (JWT-verified).
- **Multi-tenant ready:** `owner_id` is the tenant key today; a future `business_id` can slot in without reshaping the ledger.

### Scalability
- Movement ledger is append-only and indexed by `(owner_id, product_id, occurred_at)`.
- Denormalized `quantity_on_hand` / `avg_cost` on `products` keep reads O(1).
- Heavy analytics run as SQL views / materialized views, not client loops.

---

## 4. Domain Model (concepts)

- **Product** — a sellable item (SKU). Holds denormalized `quantity_on_hand` and `avg_cost`.
- **Stock movement** — the immutable ledger entry. Every quantity change is one row. **On-hand = sum of movement deltas.** This is the source of truth for quantity.
- **Movement types:** `opening`, `purchase` (in), `sale` (out), `adjustment` (+/−), `return_in` (customer returns), `return_out` (return to supplier), `transfer` (future, multi-location), `loss` (shrinkage/damage out).
- **Costing:** moving weighted average (`avg_cost`) recalculated on each `purchase`/`return_in`. Each `sale` captures `cogs_unit` = current `avg_cost` at sale time → **earnings = unit_price − cogs_unit**.
- **Tax** — each sale snapshots a tax rate (product override → profile default) and stores the tax amount; profit is computed on net (ex-tax) revenue, tax is a tracked liability.
- **Category, Supplier, Customer** — optional grouping/sourcing; customer is the CRM root that aggregates orders, invoices and sales.
- **Order** — a multi-line sale (cart/checkout) for one customer. A `draft` order is an editable basket; **confirming** it posts one `sale` movement per line (reusing the costing/tax/COGS path) and freezes it. `cancelled` orders post `return_in` movements to restore stock.
- **Order item** — a line on an order: product, quantity, snapshot unit price + tax rate; captures `cogs_unit`/`movement_id` at confirm.
- **Invoice** — accounts-receivable document auto-generated when an order is confirmed. Snapshots order totals; status `unpaid → partial → paid` (or `void`) derived from payments; carries a due date.
- **Payment** — a receipt against an invoice; the sum maintains `invoice.amount_paid`. Payments are cash receipts only — they never affect stock or profit.
- **Settings** — currency, tax rate/label/inclusive flag, low-stock defaults, business address + tax number + invoice payment terms (for invoices), costing method (future toggle).

---

## 5. Database Schema (Supabase / Postgres)

All tables include `owner_id uuid not null default auth.uid()` and RLS `using (owner_id = auth.uid())`. `id uuid default gen_random_uuid()`. Money stored as `numeric(12,2)`; **quantities are `integer` (whole units only)**; tax rates `numeric(5,2)` (percent). Timestamps `timestamptz`.

### `profiles`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK = auth user id) | no | — | 1:1 with auth.users |
| display_name | text | yes | — | |
| currency | text | no | 'USD' | ISO 4217 (single currency) |
| low_stock_default | integer | no | 0 | fallback reorder point |
| tax_label | text | no | 'VAT' | display name for tax |
| default_tax_rate | numeric(5,2) | no | 0 | % applied to sales unless product overrides |
| prices_tax_inclusive | boolean | no | true | are entered sell prices tax-inclusive? |
| business_address | text | yes | — | shown on the invoice header |
| tax_number | text | yes | — | tax/VAT registration no. on invoices |
| invoice_due_days | integer | no | 0 | default payment terms; 0 = due on issue |
| created_at | timestamptz | no | now() | |

### `categories`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| owner_id | uuid | no | auth.uid() | RLS |
| name | text | no | — | |
| created_at | timestamptz | no | now() | |

Index: `(owner_id, name)` unique.

### `suppliers`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| owner_id | uuid | no | auth.uid() | RLS |
| name | text | no | — | |
| contact | text | yes | — | phone/email/notes |
| created_at | timestamptz | no | now() | |

### `customers`  *(basic — CRM foundation)*
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| owner_id | uuid | no | auth.uid() | RLS |
| name | text | no | — | |
| contact | text | yes | — | phone/email |
| note | text | yes | — | |
| created_at | timestamptz | no | now() | |

Index: `(owner_id, name)`.

### `orders` *(multi-line sale header)*
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| owner_id | uuid | no | auth.uid() | RLS |
| order_no | text | no | — | human ref e.g. `ORD-0001`; unique per owner |
| customer_id | uuid (FK→customers) | yes | — | on delete set null (walk-in if null) |
| status | text (enum) | no | 'draft' | draft / confirmed / cancelled |
| subtotal · tax_total · total | numeric(12,2) | no | 0 | live while draft, snapshot on confirm |
| occurred_at | timestamptz | no | now() | business date |
| confirmed_at | timestamptz | yes | — | |

### `order_items` *(lines)*
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| order_id | uuid (FK→orders) | no | — | on delete cascade |
| product_id | uuid (FK→products) | no | — | on delete restrict |
| quantity | integer | no | — | whole units |
| unit_price | numeric(12,2) | no | — | snapshot (gross/net per profile flag) |
| tax_rate | numeric(5,2) | yes | — | snapshot of applied rate |
| cogs_unit | numeric(12,4) | yes | — | captured at confirm from the posted sale movement |
| movement_id | uuid (FK→stock_movements) | yes | — | links the line to its `sale` movement |

### `invoices` *(accounts receivable)*
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| owner_id | uuid | no | auth.uid() | RLS |
| invoice_no | text | no | — | `INV-0001`; unique per owner |
| order_id | uuid (FK→orders) | no | — | on delete cascade |
| customer_id | uuid (FK→customers) | yes | — | |
| status | text (enum) | no | 'unpaid' | unpaid / partial / paid / void |
| subtotal · tax_total · total | numeric(12,2) | no | 0 | snapshot from order |
| amount_paid | numeric(12,2) | no | 0 | Σ payments (trigger-maintained) |
| issued_at | timestamptz | no | now() | |
| due_at | timestamptz | yes | — | issued_at + profile.invoice_due_days |

### `payments`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| invoice_id | uuid (FK→invoices) | no | — | on delete cascade |
| amount | numeric(12,2) | no | — | |
| method | text | yes | — | cash/card/transfer (free text) |
| paid_at | timestamptz | no | now() | |

A trigger recomputes `invoices.amount_paid` + `status` on any payment change. Sequential `order_no`/`invoice_no` come from a client-side `counters` store (offline-safe for the single user).

### `products`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | |
| owner_id | uuid | no | auth.uid() | RLS |
| sku | text | yes | — | user code; unique per owner if set |
| barcode | text | yes | — | EAN/UPC; **indexed** for scan lookup |
| name | text | no | — | |
| description | text | yes | — | |
| category_id | uuid (FK→categories) | yes | — | on delete set null |
| default_supplier_id | uuid (FK→suppliers) | yes | — | on delete set null |
| unit | text | no | 'pc' | pc, kg, box… |
| image_path | text | yes | — | Supabase Storage key |
| sell_price | numeric(12,2) | yes | — | current list price (tax-inclusive per profile flag) |
| tax_rate | numeric(5,2) | yes | — | per-product override; null → profile `default_tax_rate` (use 0 for zero-rated) |
| **avg_cost** | numeric(12,4) | no | 0 | moving average, **ex-tax** (maintained by trigger) |
| **quantity_on_hand** | integer | no | 0 | denormalized (maintained by trigger) |
| reorder_point | integer | yes | — | low-stock threshold; falls back to profile default |
| reorder_qty | integer | yes | — | suggested restock amount |
| is_archived | boolean | no | false | hide without deleting (keeps ledger intact) |
| created_at | timestamptz | no | now() | |
| updated_at | timestamptz | no | now() | trigger-maintained |

Indexes: `(owner_id, barcode)`, `(owner_id, sku)` unique-when-not-null, `(owner_id, name)`, `(owner_id, is_archived)`.

### `stock_movements`  *(the ledger — append-only)*
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid (PK) | no | gen_random_uuid() | server id |
| **client_id** | uuid | no | — | **idempotency key from device**; unique per owner |
| owner_id | uuid | no | auth.uid() | RLS |
| product_id | uuid (FK→products) | no | — | on delete restrict |
| type | text (enum check) | no | — | opening/purchase/sale/adjustment/return_in/return_out/loss/transfer |
| **quantity_delta** | integer | no | — | signed: + in, − out (whole units) |
| unit_cost | numeric(12,4) | yes | — | **ex-tax** cost/unit for inbound (purchase/return_in/opening) |
| unit_price | numeric(12,2) | yes | — | sale price/unit for `sale` (gross or net per `prices_tax_inclusive`) |
| tax_rate | numeric(5,2) | yes | — | % applied to this line (snapshot of product/profile rate) |
| tax_amount | numeric(12,2) | yes | — | line tax: sales = output tax, purchases = input tax (set by trigger) |
| **cogs_unit** | numeric(12,4) | yes | — | captured ex-tax avg_cost at sale time (set by trigger) |
| supplier_id | uuid (FK→suppliers) | yes | — | for purchases |
| customer_id | uuid (FK→customers) | yes | — | for sales (optional) |
| order_id | uuid (FK→orders) | yes | — | set when posted by confirming an order |
| reference | text | yes | — | invoice/order no |
| note | text | yes | — | |
| occurred_at | timestamptz | no | now() | business date (editable for backdating) |
| created_at | timestamptz | no | now() | server insert time |

Indexes: `(owner_id, client_id)` **unique** (idempotency), `(owner_id, product_id, occurred_at desc)`, `(owner_id, type, occurred_at)`.

**Derived per row (via view, not stored):**
- `units_sold      = quantity_delta * -1`            (when sale; delta is negative)
- `gross_revenue   = units_sold * unit_price`        (what the customer paid, if prices are tax-inclusive)
- `net_revenue     = gross_revenue - tax_amount`     (ex-tax — the figure profit is based on)
- `line_value_in   = quantity_delta * unit_cost`     (when inbound, ex-tax)
- `cogs            = units_sold * cogs_unit`          (when sale)
- `profit          = net_revenue - cogs`             (**tax never counts as profit**)
- `output_tax      = tax_amount` on sales · `input_tax = tax_amount` on purchases

### `stock_counts` *(optional, Phase B — physical recount sessions)*
Header `stock_counts` + lines `stock_count_items(counted_qty)`; committing generates `adjustment` movements for variances.

### Triggers & functions
1. **`trg_movement_after_insert`** (AFTER INSERT on `stock_movements`):
   - If inbound (`purchase`/`return_in`/`opening` with `unit_cost`): recompute
     `new_avg = (qoh*avg_cost + qty_in*unit_cost) / (qoh + qty_in)` then set `products.avg_cost`, add to `quantity_on_hand`.
   - If `sale`/`loss`/`return_out` (outbound): set `cogs_unit = products.avg_cost` **before** decrement; subtract from `quantity_on_hand`. (Average cost is unchanged by outflows.)
   - If `adjustment`: apply signed delta; if positive with a `unit_cost`, treat like inbound for AVCO; if negative, leave avg_cost unchanged.
   - **Tax:** snapshot `tax_rate` (from product override → else profile `default_tax_rate`) and compute `tax_amount`:
     - prices tax-**inclusive**: `tax_amount = line_total - line_total / (1 + tax_rate/100)`
     - prices tax-**exclusive**: `tax_amount = line_total * tax_rate/100`
     (applied to sales as output tax and to purchases as input tax).
   - Set/clear low-stock state implicitly (computed in views).
2. **`trg_products_updated_at`** — maintain `updated_at`.
3. Constraint: block edits/deletes of `stock_movements` (immutable ledger); corrections are new compensating movements. Editing on-hand is done via `adjustment`.

### Views
- **`v_product_metrics`** — per product: on_hand, avg_cost, stock_value (`on_hand*avg_cost`), sell_price, margin_pct, units_sold_30d/90d, net_revenue, cogs, profit, output_tax, sell_through_rate, days_of_inventory, is_low_stock.
- **`v_dashboard_summary`** — totals: SKU count, total stock value, low-stock count, today/7d/30d net revenue, profit, tax collected, units moved.
- **`v_tax_summary`** — period output tax (sales) − input tax (purchases) = net tax liability.
- **`v_movement_ledger`** — movements joined to product + customer names with derived net_revenue/cogs/profit/tax columns.

### Migration strategy
- Tool: **Supabase migrations** (`supabase/migrations/*.sql`), timestamp-named.
- Never destructive in prod without backup; ledger table is append-only by design.
- Seed: default `profile` row on first login (Edge Function or trigger), a couple of sample categories.

---

## 6. Costing & Metrics — exact rules

| Metric | Formula |
|---|---|
| On hand | `Σ quantity_delta` for product (maintained as `quantity_on_hand`) |
| Cost per item (avg) | `avg_cost` (moving weighted average, ex-tax) |
| Stock value | `quantity_on_hand * avg_cost` |
| Net sale price (ex-tax) | `unit_price - tax_per_unit` |
| Earnings per item (per sale) | `net_sale_price - cogs_unit` |
| Margin % | `(net_sale_price - cogs_unit) / net_sale_price * 100` |
| Markup % | `(net_sale_price - cogs_unit) / cogs_unit * 100` |
| Product profit (period) | `Σ(net_revenue) - Σ(cogs)` |
| Tax collected (period) | `Σ output_tax (sales)` |
| Net tax liability | `Σ output_tax - Σ input_tax` |
| Sell-through rate (period) | `units_sold / (units_sold + on_hand_at_start) * 100` |
| Inventory turnover | `cogs_period / avg_inventory_value` |
| Days of inventory | `on_hand / avg_daily_units_sold` |
| Low stock | `quantity_on_hand <= coalesce(reorder_point, profile.low_stock_default)` |

**Edge-case rules**
- **Tax:** profit is always computed on **net (ex-tax)** revenue; tax collected is a liability, never income. Zero-rated items use product `tax_rate = 0`.
- **Negative stock:** allowed but warned (lets you sell before recording receipt); flagged in UI until reconciled.
- **Returns in (`return_in`):** re-add at original `cogs_unit` if known (carried on the sale), else at current `avg_cost`.
- **Loss/shrinkage:** outbound at `avg_cost`, recorded as `loss` so it's excluded from revenue but reduces stock value.
- **Backdating:** `occurred_at` editable; metrics use `occurred_at`, sync uses `created_at`.

---

## 7. Offline-First & Sync Strategy

### Principles
- **Reads:** cached in IndexedDB; UI renders from cache, revalidates when online (stale-while-revalidate).
- **Writes:** go to a local **outbox** first; UI updates optimistically; sync flushes to Supabase.
- **Idempotency:** every mutation carries a `client_id` UUID; the unique `(owner_id, client_id)` index makes re-sends safe.
- **Ordering:** outbox flushed FIFO so movements apply in creation order.

### Conflict handling
- **Movements:** append-only → no conflicts; duplicates collapse via `client_id`.
- **Editable entities (products, categories, suppliers, settings):** **last-write-wins per record** using `updated_at`; safe for a single user. (A future multi-user phase can upgrade to field-level merge.)

### Mechanics
- **Serwist service worker:** precache app shell; runtime-cache GET API responses; register **Background Sync** to flush the outbox when connectivity returns.
- **Dexie tables:** `outbox` (pending mutations), `cache_products`, `cache_movements`, `meta` (last_pulled_at).
- **Pull:** on app open/online, fetch rows where `updated_at`/`created_at > last_pulled_at`; upsert into cache.
- **Status UI:** global "Offline — N pending" indicator; per-item "syncing/synced" badges.

---

## 8. UI / UX — Mobile-First

### Design principles
- Thumb-first: primary actions as a bottom **tab bar** + a floating **scan** button.
- One-hand operation; large tap targets; minimal typing (scan + steppers).
- Every screen handles **loading / empty / error / offline** states.
- Plain language, currency-aware, instant optimistic feedback.

### Navigation (bottom tab bar)
`Dashboard · Products · ⦿ Scan (center FAB) · Orders · More`
*(Movements/Activity moved to More + desktop sidebar after Phase C — daily order entry outranks the ledger on mobile. Reconciled 2026-07-04.)*

### Screen inventory

| # | Screen | Route | Purpose |
|---|---|---|---|
| 1 | Onboarding / Auth | `/login`, `/welcome` | Sign in (magic link/password), set currency, tax rate & business name. |
| 2 | Dashboard | `/` | KPIs: stock value, low-stock count, today/7d/30d net revenue & profit, tax collected, top sellers, recent activity. |
| 3 | Scan | `/scan` | Camera scanner; routes a hit to product detail or quick-action sheet; miss → "Add product". |
| 4 | Quick Action sheet | (modal) | After scan: **Receive** / **Sell** / **Adjust** with qty stepper + price/cost. |
| 5 | Products list | `/products` | Searchable/filterable list with on-hand, value, low-stock badges. |
| 6 | Product detail | `/products/[id]` | Stats (on-hand, avg cost, sell price, margin, profit, turnover), movement history, actions. |
| 7 | Add/Edit product | `/products/new`, `/products/[id]/edit` | Create/edit; scan to fill barcode; photo upload. |
| 8 | Receive stock | `/products/[id]/receive` | Purchase in: qty, unit cost, supplier, reference. |
| 9 | Sell / Stock out | `/products/[id]/sell` | Sale: qty, unit price (prefilled), **optional customer**, live earnings + tax breakdown. |
| 10 | Adjust stock | `/products/[id]/adjust` | Manual +/− with reason (count, loss, correction). |
| 11 | Movements ledger | `/movements` | Filterable history (type, product, customer, date); each row shows qty, net value, tax, profit. |
| 12 | Reports | `/reports` | Profit by product, sell-through, low-stock/reorder list, **tax summary**, inventory value over time, export CSV. |
| 13 | Categories / Suppliers | `/settings/categories`, `/settings/suppliers` | Manage lookups. |
| 13a | Customers | `/customers`, `/customers/[id]` | Customer hub: lifetime revenue/profit, balance owed, orders, invoices, sales history. |
| 13b | Orders | `/orders`, `/orders/new`, `/orders/[id]` | Multi-line cart/checkout; confirm posts sales + auto-creates an invoice; cancel returns stock. |
| 13c | Invoices | `/invoices`, `/invoices/[id]` | A/R list + printable invoice document, record payments, CSV export, void. |
| 14 | Settings / More | `/settings` | Currency, **tax rate + label + inclusive/exclusive**, low-stock default, install PWA, sync status, export/backup, sign out. |

### Per-screen states (pattern applied to all)
| State | Behavior |
|---|---|
| Loading | Skeletons (never full-screen spinners on cached screens). |
| Empty | Friendly message + primary CTA (e.g. "No products yet — Scan to add"). |
| Error | Inline error + retry; never lose user input. |
| Offline | Banner + optimistic writes queued; "pending sync" badges. |

### Key user journeys

1. **First run / onboarding**
   `Welcome → Sign in → Set currency + business name → (optional) add first product by scan → Dashboard`

2. **Receive stock (purchase in)** — *daily*
   `Scan barcode → (hit) Quick Action: Receive → qty + unit cost + supplier → Save → on-hand ↑, avg_cost recalculated → toast "Received 12 × Widget"`
   *Barcode miss → "Add product?" prefilled with barcode → save → continue receive.*

3. **Sell (stock out)** — *daily, the core loop*
   `Scan → Quick Action: Sell → qty + price (prefilled) + optional customer → live earnings & tax shown → Save → on-hand ↓, COGS captured, net profit + output tax recorded → toast "Sold 2 × Widget · +$7.40 profit"`

4. **Check what to reorder**
   `Dashboard low-stock card → Reorder list → per item: on-hand vs reorder point + suggested qty → tap → Receive`

5. **Understand a product's profitability**
   `Products → tap item → Product detail: margin, 30/90-day units sold, profit, turnover, days of inventory, full movement history`

6. **Stocktake / correction**
   `Product detail → Adjust → enter counted qty or +/− with reason → adjustment movement created → variance recorded`

7. **Offline shift**
   `Go offline → scan + receive/sell repeatedly (all queued) → return online → outbox auto-flushes → badges turn "synced"`

### Navigation map (selected)
| From | To | Trigger |
|---|---|---|
| Any tab | Scan | Center FAB |
| Scan (hit) | Quick Action sheet | Barcode matched |
| Scan (miss) | Add product | "Add product" CTA |
| Dashboard low-stock | Reorder list | Tap card |
| Products | Product detail | Tap row |
| Product detail | Receive/Sell/Adjust | Action buttons |

---

## 9. API / Data Access Contract

Primary access is **Supabase PostgREST** (auto REST over tables/views) guarded by RLS, plus a few **Edge Functions** for batch sync and CSV export. Logical contract:

| Operation | Method / Source | Notes |
|---|---|---|
| List products | `GET /products?select=*` (cached) | RLS-scoped; filters by name/barcode/category. |
| Lookup by barcode | `GET /products?barcode=eq.<code>` | Single-row scan lookup. |
| Create/Update product | `POST/PATCH /products` | `updated_at` drives LWW. |
| Record movement | `POST /stock_movements` | Body carries `client_id`; duplicate `client_id` → ignored (idempotent). |
| **Batch sync movements** | `POST /functions/v1/sync-movements` | Array of outbox items; returns per-item `{client_id, status}`. |
| Pull deltas | `GET /...?updated_at=gt.<ts>` | For each cached table. |
| Dashboard summary | `GET /v_dashboard_summary` | Single-row view. |
| Product metrics | `GET /v_product_metrics?id=eq.<id>` | Computed analytics. |
| Reports / export | `POST /functions/v1/export-csv` | Returns signed CSV URL. |
| Image upload | Supabase Storage `products/<owner>/<id>` | Signed upload URL. |

Errors follow PostgREST shape: `{ code, message, details }`; client maps to friendly messages and keeps the outbox intact on failure.

---

## 10. Production Readiness Checklist

- **Auth & security:** RLS on every table; Storage policies owner-scoped; JWT-verified Edge Functions; no secrets in client (`.env.example` documents keys).
- **Data integrity:** immutable ledger; idempotency keys; DB triggers as the single place computing on-hand/avg_cost/COGS.
- **Backups:** daily export Edge Function → Storage; document restore steps in `MONITORING.md`.
- **Observability:** Sentry (client + edge), Vercel Analytics, Supabase logs; alert on error-rate spike and failed syncs.
- **Performance:** indexed scan lookups; denormalized balances; paginated lists; image compression on upload.
- **PWA quality:** Lighthouse PWA pass (installable, offline shell, fast); maskable icons; splash; iOS `apple-touch-icon`.
- **Testing:** unit (costing math), integration (movement triggers via Supabase test DB), E2E (Playwright: scan→sell→profit, offline→sync).
- **CI/CD:** GitHub Actions (lint, typecheck, test, build) → Vercel preview per PR → prod on merge to `main`; Supabase migrations applied in pipeline.
- **Accessibility:** keyboard reachable, ARIA on controls, contrast AA, large tap targets.
- **Legal/ops:** privacy note (data is the owner's), data export + account delete.

---

## 11. Roadmap (phased)

### Phase A — MVP (the core loop)
Auth + profile/currency/tax settings · Products CRUD + photo + per-product tax rate · Barcode scan lookup/add · Receive / Sell / Adjust movements · Optional customer on sales · Triggers for on-hand + avg_cost + COGS + tax · Dashboard KPIs (net revenue, profit, tax) · Movements ledger · Low-stock list · **Offline-first reads + outbox sync** · PWA install.

### Phase B — Insights & control ✅ delivered
Reports (profit by product, sell-through, turnover, days of inventory) · CSV export · Stocktake/recount sessions · Velocity-based reorder suggestions · Categories/suppliers/customers management · Charts.
- Metrics in `src/lib/metrics.ts`: sell-through, avg daily sales, days of inventory, turnover, reorder suggestion (lead-time × velocity), daily sales series, and **inventory value over time via full ledger replay** (exact, no stored history).
- Charts are dependency-free inline SVG (`src/components/Charts.tsx`): line/area, sparkline, bar list.
- Stocktake: `stock_counts` + `stock_count_items` (Dexie v2 + Supabase migration). Committing a count generates `adjustment` movements for each variance.
- Reorder lead time default = 14 days (`DEFAULT_LEAD_DAYS`).

### Phase C — Customer management ✅ delivered
Full CRM: customer hub (lifetime revenue/profit, balance owed, order/invoice/sales history) · multi-line **orders** (cart/checkout with barcode scan) that post one `sale` movement per line on confirm · **invoices** auto-created on confirm with accounts-receivable (payments, partial/paid status, due dates, outstanding balances) · printable invoice document + CSV export · order cancel → `return_in` restock + invoice void.
- New Dexie v3 tables: `orders`, `orderItems`, `invoices`, `payments`, `counters` (sequential `ORD-`/`INV-` numbers). `order_id` added to `stock_movements`.
- Repo: `createDraftOrder`/`addOrderItem`/…/`confirmOrder` (+auto-invoice)/`cancelOrder`, `recordPayment`/`voidInvoice` in `src/lib/repo.ts`; rollups in `src/lib/customers.ts`.
- Confirming an order reuses `recordMovement`, so dashboard/reports/product metrics include order sales with zero double-counting; invoices/payments never touch stock.

### Phase D — Scale & power
Multi-location/transfers · Team users + roles (activate tenant boundary) · FIFO costing option · Supplier purchase orders · Online-store integration (Shopify/WooCommerce) · Backups/restore UI · Label printing.

---

## 12. Resolved Questions
1. **Currency:** single currency (profile-level). ✅
2. **Units:** whole units only — quantities are integers. ✅
3. **Tax/VAT:** tracked from MVP — per-sale output tax + purchase input tax, net liability reporting, profit on net revenue. ✅
4. **Customer field on sales:** `customers` table + optional `customer_id` on sales, included in MVP. ✅

### Still to confirm later
- Tax registration number / tax on invoices/receipts (if you later print/export receipts).
- Whether purchases should always capture input tax, or only when you're tax-registered.

---

## 13. Change Log
| Date | Change | By |
|---|---|---|
| 2026-06-24 | Initial SSOT created (validation, stack, architecture, schema, costing, offline, UX, roadmap). | Kit + Claude |
| 2026-06-24 | Resolved open questions: single currency, whole units (integer qty), tax/VAT tracking in MVP, customers table + customer_id on sales. | Kit + Claude |
| 2026-06-24 | Phase A MVP built (offline-first, Dexie + Next.js 15 PWA; Supabase optional/off). | Kit + Claude |
| 2026-06-24 | Phase B delivered: advanced metrics, inline SVG charts, stocktake sessions, velocity reorder suggestions. | Kit + Claude |
| 2026-06-28 | Phase C delivered: customer management — multi-line orders, invoices with accounts-receivable (payments/balances/due dates) + printable invoice doc, customer hub. Dexie v3 + Supabase migration `20260628010000_orders_invoices.sql`. | Kit + Claude |
| 2026-06-28 | Auth UI (Phase D start): `/login`, `/signup`, `/forgot-password`, `/reset-password` pages wired to Supabase Auth (`src/lib/auth.ts` helpers + `useSession`; shared `AuthShell`). Cloud-optional — pages degrade to a "continue offline" notice when Supabase isn't configured. Nav chrome hidden on auth routes. Build = 23 routes. | Kit + Claude |
| 2026-07-04 | **Gap-audit remediation** (see `StockDesk-GapAudit-2026-07-04.md`). Bugs: product-detail hooks crash fixed; net revenue/profit correct in tax-exclusive mode (movements snapshot `tax_inclusive`); unknown-id routes show "not found"; Reset clears all 14 tables; photo removal persists; manual scan lookup matches SKU too. Validation: oversell warns + negative-stock flagged (products/detail/dashboard); duplicate SKU/barcode and duplicate lookup names rejected; money ≥ 0 at 2dp, tax rates 0–100; overpayment blocked; paid invoices can't be voided (nor orders with payments cancelled); stocktake counts ≥ 0; archived products blocked in scan/cart flows; categories/suppliers editable + deletable (refs cleared). Sync: profile id remapped to auth uid; photos never pushed; movements insert idempotently on `(owner_id, client_id)`; **pull-delta sync** for all 12 tables with LWW + `meta.last_pulled`; deletes propagate (`delete` op); permanent-vs-transient error split with retry/discard UI; strict FIFO via monotonic `seq`; flush scheduled outside Dexie transactions + gated on session; account binding (owner mismatch pauses sync); Background Sync tag + 60s retry timer; counters bumped past pulled ORD-/INV- numbers. Flows/screens: `/welcome` onboarding (currency/tax/name); dashboard adds SSOT KPI row (stock value, today/7d/30d, tax, top sellers); movements ledger gains product/customer/date filters + net/tax per row + pagination; customer hub gains itemized sales history; loss/return_in/return_out recordable from Adjust; movement/payment/order backdating; scan-miss continues into Receive; magic-link sign-in; Install-PWA card + JSON backup/restore in Settings; global offline/sync banner + per-row pending badges. States/PWA: `error.tsx`/`global-error.tsx`/`not-found.tsx`; skeleton loaders on all screens; scanner error differentiation + retry; `/~offline` navigation fallback precached; PNG icon set (192/512 + maskable + 180px apple-touch-icon). SQL migration `20260704000000_sync_hardening.sql`: `tax_inclusive` column, BEFORE/AFTER trigger split (idempotent re-sends), immutable-ledger guard, `v_dashboard_summary`/`v_tax_summary`/extended `v_product_metrics`. Build = 25 routes. | Kit + Claude |
