# StockDesk — Gap Audit (2026-07-04)

> **STATUS: REMEDIATED (2026-07-04).** All findings below were fixed the same day — Phases 1–5 implemented in one pass (see SSOT changelog entry 2026-07-04 for the itemized list). Two intentional exceptions: **B12** (batch `sync-movements` Edge Function — superseded by idempotent per-row inserts + the AFTER-trigger split in migration `20260704000000_sync_hardening.sql`, which achieves the same safety without an undeployed function) and **B2** (photos now cleanly excluded from sync rather than uploaded to Storage — a Storage bucket + signed-URL pipeline remains future work; photos are device-local by design for now). Verified by `tsc`, `next build` (25 routes), route smoke tests incl. unknown-id pages, and 15 unit assertions over the tax/AVCO/stock-flag math.

Codebase audited against `StockDesk-SSOT.md` across six dimensions (screens, flows, fields, validation, offline/sync, UI states) by parallel auditors, with adversarial verification of each claim. **Verification status:** ✅ = independently re-verified against the code, ◐ = confirmed but scope corrected, ○ = evidence cited by auditor, not independently re-checked.

Severity: **H** = breaks a core journey / corrupts data · **M** = SSOT requirement missing or reachable bad state · **L** = polish / deviation.

---

## A. Bugs (broken today, fix first)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | H ✅ | **Product detail crashes once data loads** — `useMemo` at `products/[id]/page.tsx:45,49` runs *after* the conditional early returns at `:36-39`. First render exits with 8 hooks, the loaded render has 10 → React "Rendered more hooks" error. Kills journeys 2, 4, 5, 6 (the hub screen for receive/sell/adjust/profitability). | `src/app/products/[id]/page.tsx:36-52` |
| A2 | H ✅ | **Profit/net revenue wrong in tax-exclusive mode** — with `prices_tax_inclusive=false`, tax is added on top (`inventory.ts:110-123`, correct in `computeOrderTotals`), but `movementNetRevenue` (`inventory.ts:167-170`) and the sell-form preview (`MovementForm.tsx:44-48`) still subtract `tax_amount` from gross — double-deducting tax. Ledger/dashboard/reports understate profit and disagree with invoices generated from the same sales. | `src/lib/inventory.ts:162-180`, `src/components/MovementForm.tsx:41-57`, `src/lib/repo.ts:303-321` |
| A3 | H ✅ | **Unknown-id detail routes hang on "Loading…" forever** — `db.table.get(id)` via `useLiveQuery` resolves `undefined` both while loading *and* when missing, so the "not found" branches are dead code on 7 routes (products, product edit, orders, invoices, customers, customer edit, stocktake). | `src/lib/hooks.ts:42-44,69-71,89-91,108-110,136-138` |
| A4 | M ✅ | **"Reset all data" leaves 8 of 14 tables** — clears products/movements/categories/suppliers/customers/outbox only. Orders, order items, invoices, payments, counters, stock counts + items, and profile survive; old invoices reference deleted products, receivables stay populated. | `src/lib/seed.ts:71-86`, `src/app/settings/page.tsx:173-183` |
| A5 | L ○ | **"Remove photo" silently fails on edit** — form maps cleared image to `undefined`; `saveProduct` does `input.image_data ?? existing.image_data`, restoring the old photo. No way to clear a photo. | `src/components/ProductForm.tsx:102,250-259`, `src/lib/repo.ts:72` |
| A6 | L ○ | **Scanner manual entry claims SKU lookup but only searches barcode** — label says "barcode / SKU"; both consumers use `findByBarcode` (barcode index only). A valid SKU lands in "No product found" and offers to create a duplicate. | `src/components/Scanner.tsx:74`, `src/lib/repo.ts:117-119` |

## B. Cloud sync defects (silent, permanent failures when Supabase is enabled)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B1 | H ○ | **Profile can never sync** — local profile PK is the literal string `"local"`; server `profiles.id` is `uuid references auth.users`. Every settings change enqueues a permanently-failing upsert (invalid uuid), retried forever; nothing remaps to `auth.uid()` after sign-in. | `src/lib/db.ts:19,68-79`, `src/lib/repo.ts:31-36`, `supabase/migrations/20260624000000_init.sql:10-11` |
| B2 | H ○ | **Products with photos permanently fail to sync** — local `image_data` (base64 data URL) has no server column (`image_path` only) and there is zero Supabase Storage upload code. PostgREST rejects the unknown column; since every movement re-enqueues the product row, the outbox grows without bound. | `src/lib/types.ts:66-68`, `src/lib/sync.ts:61`, `init.sql:56-76` |
| B3 | H ✅ | **Sync is push-only — no pull, ever** — `sync.ts` has no pull function, no `meta`/`last_pulled_at` store. A reinstall, cleared IndexedDB, or second device starts empty despite a populated cloud DB; the SSOT's last-write-wins conflict rule is unimplemented (blind upsert overwrites server unconditionally). | `src/lib/sync.ts` (whole file), `src/lib/db.ts:39-62` |
| B4 | H ◐ | **Movement resend double-applies stock server-side** — flush uses `upsert(payload)` conflicting on PK `id`, never on the unique `(owner_id, client_id)` idempotency index; `fn_apply_movement` is BEFORE INSERT, so its stock/AVCO side effects run before conflict resolution. A retried movement (insert succeeded, response lost) applies the delta twice. | `src/lib/sync.ts:59-61` (verified), `init.sql:107,140-211` |
| B5 | M ○ | **Local deletes never propagate** — outbox supports only `upsert`/`insert`; `removeOrderItem`, `deleteDraftOrder`, `deleteStockCount` hard-delete locally after the rows were already pushed → ghost orders/lines/stocktakes in the cloud; `deleted?:` flags on 5 types are dead code. | `src/lib/types.ts:205`, `src/lib/repo.ts:253-258,432-451` |
| B6 | M ✅ | **No permanent-vs-transient error handling, errors invisible** — every failure just increments `attempts` and re-retries forever (no backoff, no dead-letter); `attempts`/`last_error` are never displayed; flush isn't gated on an active session (pushes while signed out → RLS rejects everything) and Settings' "Connected" label reflects env vars, not a session. | `src/lib/sync.ts:47-77`, `src/lib/supabase.ts:6`, `src/app/settings/page.tsx:138-155` |
| B7 | M ○ | **FIFO ordering not guaranteed** — failed entries are skipped (later rows land first; server trigger then bakes wrong COGS/AVCO), and same-millisecond entries (movement + product enqueued back-to-back) tie on `created_at` and flush in random order. Needs a monotonic sequence number. | `src/lib/sync.ts:56-72`, `src/lib/repo.ts:159-163` |
| B8 | M ○ | **Immediate flush fires inside Dexie transactions** (zone leak) — `void flushOutbox()` is invoked from within rw-transactions that include `outbox`; after the awaited network call the ambient transaction has committed and the outbox delete/update likely throws, so real-time flush quietly fails until the next trigger. *Reasoned from Dexie 4 semantics, not observed at runtime.* | `src/lib/sync.ts:38-42`, `src/lib/repo.ts:140-164,472-534` |
| B9 | M ○ | **No Background Sync registration** — `sw.ts` is bare precache + runtime cache; if the tab is closed when connectivity returns (the normal phone case), queued writes sit until next app open. | `src/app/sw.ts:14-22`, `src/app/providers.tsx:17-21` |
| B10 | M ○ | **No account isolation** — sign-out keeps the shared Dexie DB and no route gating exists; the next sign-in on the device sees and *flushes the previous account's unsynced rows to their own cloud tenant* (owner_id defaults to auth.uid() on insert). | `src/lib/auth.ts:97-105`, `src/lib/db.ts:38` |
| B11 | L ○ | **ORD-/INV- counter collisions unrecoverable** — second device or post-reset counters restart at 1 → unique-index 23505 failures retried forever, dependent invoice/payment FKs fail too. Accepted single-device risk per SSOT, but no detection or renumber path. | `src/lib/db.ts:94-99`, `20260628010000_orders_invoices.sql:34,74` |
| B12 | L ○ | **`sync-movements` batch Edge Function absent** (§9 contract) — per-row PostgREST push is mostly equivalent but loses atomic ordered application and per-item `{client_id, status}` results. | no `supabase/functions/` |

## C. Missing flows (SSOT journeys)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| C1 | H ✅ | **No onboarding/welcome** — no `/welcome`, no first-run setup; signup/login land on `/` with a silently-created default profile (USD, VAT 0%, "My Store"). Currency + tax-inclusive flag affect every price from the first movement; wrong-regime data has no migration path. | `src/app/signup/page.tsx:44-48`, `src/app/providers.tsx:10`, `src/lib/db.ts:68-87` |
| C2 | M ◐ | **Reorder journey degraded** — dashboard "Low stock" card links to *unfiltered* `/products` (no low-stock filter exists); `/reports` reorder rows are dead `<li>`s (no tap-through). Working path: "Reorder soon" card → product detail (suggested qty + Receive button) — which currently crashes (A1). | `src/app/page.tsx:118-125`, `src/app/reports/page.tsx:163-188` |
| C3 | M ○ | **Movement types `loss`, manual `return_in`, `return_out`, `opening` uncreatable** — MovementForm only posts purchase/sale/adjustment, yet the ledger offers "Losses / Returns in / Returns out" filter chips that can never match user data. Shrinkage is indistinguishable from count corrections. | `src/components/MovementForm.tsx:12,62-94`, `src/app/movements/page.tsx:15-17` |
| C4 | M ○ | **No `occurred_at` backdating input anywhere** — plumbing exists end-to-end but no form exposes a date (movements, orders; `payments.paid_at` likewise). Yesterday's stockroom work is attributed to today in all period metrics. | `src/components/MovementForm.tsx:29-37`, `src/components/PaymentForm.tsx:54-74` |
| C5 | L ○ | **Scan-miss "Add product" doesn't continue into Receive** — after saving, routes to product detail instead of reopening the Receive quick-action (journey 2's "save → continue receive"). | `src/app/scan/page.tsx:108-137` |
| C6 | L ○ | **Magic-link sign-in absent** — email+password only; SSOT specifies magic link + password. | `src/app/login/page.tsx:27`, `src/lib/auth.ts` |

## D. Missing screen content

| # | Sev | Finding | Evidence |
|---|---|---|---|
| D1 | M ✅ | **Dashboard omits SSOT KPIs** — no stock value, no profit, no tax collected, no top sellers, no today/7d/30d splits ("today" exists nowhere in the app; reports minimum is 7d). An unused SSOT-shaped `DashboardSummary` hook already exists. | `src/app/page.tsx:76-245`, `src/lib/hooks.ts:173-202` (dead code) |
| D2 | M ◐ | **Movements ledger under-filtered** — type filter only (no product/customer/date), hard 300-row cap, rows lack net value + tax. Mitigations: per-product history on product detail, CSV export with net/tax. Customer-filtered direct sales remain unviewable anywhere (see D3). | `src/app/movements/page.tsx:20-47`, `src/lib/hooks.ts:54-59` |
| D3 | M ✅ | **Customer hub has no itemized sales history** — direct (non-order) sales with a customer are in the rollup/sparkline but invisible as line items; combined with D2 they can't be isolated anywhere in the app. | `src/app/customers/[id]/page.tsx:35,41-48,114-165` |
| D4 | M ✅ | **Install-PWA entry only on auth pages** — local-only users (the default mode) never pass through auth, so the primary persona can never discover install. Settings has no install entry. | `src/components/AuthShell.tsx:34`, grep: only mount point |
| D5 | M ○ | **No data export/backup in Settings** — only "Load sample data" and destructive reset; movements-only CSV is not a restorable backup for an IndexedDB-resident dataset. | `src/app/settings/page.tsx:157-185` |
| D6 | L ✅ | **Bottom tab bar deviates from SSOT** — Movements replaced by Orders (sensible post-Phase-C, but SSOT §8 not updated; reconcile doc or nav). | `src/components/BottomNav.tsx:8-13` |

## E. Missing validation / reachable bad states

| # | Sev | Finding | Evidence |
|---|---|---|---|
| E1 | H ✅ | **Negative stock: no warning on oversell, no flag** — sell/adjust/order-confirm never compare qty to on-hand; no screen flags negative on-hand; `isLowStock` returns false when threshold is 0, so a product at −3 with no reorder point shows *no indicator at all* (SSOT: "allowed but warned; flagged until reconciled"). | `src/components/MovementForm.tsx:59-102`, `src/lib/repo.ts:470-535`, `src/lib/inventory.ts:193-196` |
| E2 | H ✅ | **Duplicate SKU/barcode never checked** — duplicate barcode makes scan sell/receive against an arbitrary product (`findByBarcode().first()`); duplicate SKU violates the server unique index → that outbox row fails on every flush forever. | `src/lib/repo.ts:57-107,117-119`, `init.sql:79` |
| E3 | H ✅ | **Negative prices/costs accepted everywhere** — negative `unit_cost` blends into AVCO (poisoning stock value/COGS/all profit); negative sale price → negative revenue; a negative-total order confirms and its invoice is instantly "paid". No 2-dp constraint on money inputs. | `src/components/MovementForm.tsx:67,78,91`, `src/components/OrderCart.tsx:147`, `src/lib/repo.ts:520` |
| E4 | M ✅ | **Tax rate unbounded** — rate −100 with inclusive prices → division by zero → `Infinity` tax flowing into movements, orders, invoices; >100 drives every sale's profit negative. | `src/components/ProductForm.tsx:180-182`, `src/app/settings/page.tsx:91-98`, `src/lib/inventory.ts:36-46` |
| E5 | M ◐ | **Overpayment accepted, then hidden** — paying 500 on a 100 invoice: `amount_paid=500`, status "paid"; invoice page clamps display (`Math.max(0, …)`), so the 400 credit vanishes. (Home receivables KPI is *not* affected — that part of the claim was in dead code `useDashboard`.) | `src/components/PaymentForm.tsx:29-33`, `src/lib/repo.ts:583-617`, `src/app/invoices/[id]/page.tsx:44` |
| E6 | M ✅ | **Void unguarded** — paid/partial invoices can be voided (UI offers it for every non-void status) and `cancelOrder` voids paid invoices; attached payments are orphaned — received cash disappears from A/R with no refund/credit flow. | `src/lib/repo.ts:542-579,619-627`, `src/app/invoices/[id]/page.tsx:125-129` |
| E7 | M ✅ | **Ledger immutability not enforced server-side** — RLS grants owner full UPDATE/DELETE on `stock_movements` via PostgREST; the trigger is BEFORE INSERT only, so an edit/delete desyncs `quantity_on_hand`/`avg_cost` with nothing to recompute. Client is clean; the SSOT's DB constraint was never written. | `init.sql:208-211,285-286` |
| E8 | M ✅ | **Stocktake accepts negative counted qty** — `-5` is stored, shown as variance, and committing drives stock negative via the reconciliation feature itself. | `src/app/stocktake/[id]/page.tsx:100-103`, `src/lib/repo.ts:245-251` |
| E9 | M ✅ | **Archived products fully transactable via scan** — `findByBarcode` doesn't filter `is_archived`; scan page offers Sell/Receive/Adjust with no archived indication; order-cart scan adds archived items (its picker list correctly filters them). | `src/lib/repo.ts:117-119`, `src/app/scan/page.tsx:24-37`, `src/components/OrderCart.tsx:215-223` |
| E10 | M ◐ | **Duplicate lookup names accepted** — duplicate category names violate the server unique index (that row retries forever — other rows still flush); duplicate suppliers/customers just accumulate. Compounded by E11: duplicates can never be cleaned up. | `src/components/LookupManager.tsx:39-56`, `src/lib/repo.ts:169-214`, `init.sql:31` |
| E11 | L ✅ | **Categories/suppliers are add-only** — no edit or delete affordance (repo supports renames; UI never passes an id). Typos are permanent. | `src/components/LookupManager.tsx:70-89` |
| E12 | L ✅ | **Negative settings/reorder values accepted** — `low_stock_default`, `reorder_point`, `reorder_qty` truncate but never clamp ≥0 (compare `invoice_due_days`, which is clamped); `tax_label`/`display_name` can be blanked with no fallback. | `src/app/settings/page.tsx:112-121`, `src/components/ProductForm.tsx:99-100` |

## F. Fields with no UI exposure / schema drift

| # | Sev | Finding | Evidence |
|---|---|---|---|
| F1 | L ✅ | Order `note` (setter exists, never called), movement `note` on receive (rendered only when mode ≠ receive), movement `reference` on sell (rendered only on receive), `payments.paid_at` (no date input) — all set-able in schema, unreachable in UI. | `src/lib/repo.ts:372-379`, `src/components/MovementForm.tsx:150-152,192-196`, `src/components/PaymentForm.tsx:54-74` |
| F2 | L ✅ | SQL analytics views fall short of §5 — `v_dashboard_summary`/`v_tax_summary` don't exist; `v_product_metrics` lacks margin_pct, 90d units, output_tax, sell-through, days-of-inventory, is_low_stock. Mitigated: app computes everything client-side; §9 view contract unfulfilled server-side. | `init.sql:225-260`, `src/lib/metrics.ts` |
| F3 | L ○ | Dead `deleted?: boolean` flags on Category/Supplier/Customer/Order/Invoice — never set, no SQL column (see B5). | `src/lib/types.ts:36,45,55,116,149` |

## G. UI states & PWA quality

| # | Sev | Finding | Evidence |
|---|---|---|---|
| G1 | M ○ | **No error boundaries anywhere** — no `error.tsx`/`global-error.tsx`/`not-found.tsx` under `src/app`; any render/live-query throw (IndexedDB unavailable, A1's crash) shows Next's raw client-exception screen. | glob: no matches |
| G2 | M ○ | **No offline app-shell fallback** — precache covers only `/_next/static` chunks + icon + manifest; zero HTML routes. Launching the installed PWA offline before visiting a route (or after the 24 h pages-cache expiry) yields the browser network-error page. | `src/app/sw.ts:14-22`, `public/sw.js` |
| G3 | M ○ | **PWA icons incomplete** — single SVG with combined `any maskable` purpose; `apple-touch-icon` is SVG (unsupported on iOS — A2HS produces a grey tile, exactly the flow InstallApp walks users through); no splash/startup image; no 192/512 PNGs. | `public/manifest.webmanifest:10-17`, `src/app/layout.tsx:13` |
| G4 | M ○ | **`/orders/new` has no error path** — `createDraftOrder(...).then(...)` with no `.catch`; a failed Dexie write strands the user on "Starting order…" forever (the `started` ref blocks re-attempts). | `src/app/orders/new/page.tsx:7-28` |
| G5 | M ○ | **Silent mutation failures** — settings save, stocktake start/commit + count-item save, lookup add, and order-cart line edits have no catch → no feedback, silently unsaved (MovementForm/ProductForm/PaymentForm do this correctly; apply the same pattern). | `src/app/settings/page.tsx:22-30`, `src/app/stocktake/[id]/page.tsx:38-47`, `src/components/OrderCart.tsx:100-148` |
| G6 | L ○ | **Loading states are bare "Loading…" text on 13 of 14 screens** — skeleton exists only on the dashboard; SSOT mandates skeletons on cached screens. | all list/detail pages |
| G7 | L ○ | **Scanner failure modes undifferentiated, no retry** — one generic message for permission-denied / no camera / busy / insecure context; camera only re-attempts on remount; `active` state is dead code for an unbuilt stop/retry control. Manual fallback exists, so not blocking. | `src/components/Scanner.tsx:15-46` |
| G8 | M ✅ | **No global "Offline — N pending" banner or per-item sync badges** — the only sync surface is a count row in Settings; no component subscribes to online/offline for display; outbox entries aren't correlated to entities, so per-item badges are structurally absent. | `src/lib/hooks.ts:92-94`, `src/app/settings/page.tsx:146-149` |

---

## What's solid (verified working)

Scan → quick-action → Sell/Receive/Adjust sheets with live earnings/tax preview and profit toast; barcode-miss → prefilled add-product; AVCO/COGS/tax math (inclusive mode) matching the SQL trigger rule-for-rule; whole Phase C loop (draft cart with scan-to-add, confirm → per-line sale movements + auto-invoice with due date, cancel → return_in at captured COGS + void, payments with unpaid/partial/paid derivation, printable invoice, per-invoice CSV, walk-in orders); stocktake sessions with variance-commit; reports (profit by product, sell-through, reorder suggestions, tax summary, inventory-value-over-time, CSV); customers hub rollups; qty steppers clamped to positive integers; payment/order state-machine guards (void-pay block, empty-confirm block, draft-only edits); auth pages with graceful cloud-off degradation; field-for-field schema parity for profiles/lookups/orders/invoices/payments/stock counts; empty states with CTAs on all list screens.

---

## Implementation plan (proposed phases)

**Phase 1 — Correctness (small diffs, do first): A1–A6.**
Hoist the two `useMemo`s above the early returns; make single-row hooks resolve `?? null` and wire the dead "not found" branches; fix `movementNetRevenue`/sell-preview to respect `prices_tax_inclusive`; extend `resetDatabase` to all 14 tables; pass explicit `null` for cleared photos; search SKU in manual scanner entry (or fix the label).

**Phase 2 — Validation guardrails: E1–E12.**
Oversell warning + persistent negative-stock badge (fix the threshold-0 hole); duplicate SKU/barcode check on save; `min=0` + bounds on all money/tax/reorder inputs (tax 0–100); overpayment cap (or explicit credit); void guard (block or confirm when payments exist); stocktake `min=0`; archived-product guard in scan paths; duplicate-name checks; lookup edit/delete UI.

**Phase 3 — Sync correctness (the deepest work): B1–B12.**
Map profile id to `auth.uid()` on sign-in; move photos to Supabase Storage (`image_path`) or strip `image_data` from payloads; insert movements with `onConflict: owner_id,client_id, ignoreDuplicates` instead of PK upsert; add pull-delta sync + `meta.last_pulled_at` (restores LWW and second-device/restore); add `delete` op to the outbox (or real soft-deletes); classify permanent vs transient errors + surface `last_error`; monotonic outbox sequence; move flush out of Dexie transactions; gate flush on session; SW Background Sync; per-account DB or purge on sign-out; SQL migration blocking UPDATE/DELETE on `stock_movements` (E7 lands here too).

**Phase 4 — Missing flows & screens: C1–C6, D1–D6.**
First-run onboarding (currency, tax, business name); offline banner + pending badges (G8); reorder journey wiring (low-stock filter on /products, tappable report rows); scan-miss → continue-receive; loss/return movement modes in the adjust form; `occurred_at`/`paid_at` date inputs; dashboard KPI row (stock value, today/7d/30d revenue & profit, tax, top sellers — the dead `DashboardSummary` hook is a head start); movements filters (product/customer/date) + pagination; customer sales-history section; Install-PWA card in Settings; JSON export/import backup; magic-link option; reconcile SSOT nav (Orders tab) in §8.

**Phase 5 — States & PWA polish: G1–G7, F1–F2.**
Root `error.tsx` + `not-found.tsx`; offline fallback page in the SW precache; PNG icon set (192/512 + separate maskable) + 180 px apple-touch-icon + splash; catch handlers on `/orders/new` and the silent-failure mutations; skeletons on list screens; scanner error differentiation + retry; expose the four orphaned fields (F1); optional SQL views catch-up (F2).

*Per SSOT §0 note: update `StockDesk-SSOT.md` (nav map, dashboard KPI set, movements-tab decision) alongside Phase 4 so the doc stays canonical.*

---

*Audit provenance: 6 dimension auditors + 40 adversarial verifications (36 confirmed, 4 corrected-in-scope, 0 refuted); 27 verifications were cut short by an org spend limit — the four highest-impact of those claims (A1, A2, B4-client-half, A4) were re-verified manually, marked ✅ above; ○ items retain auditor-cited file:line evidence.*
