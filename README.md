# StockDesk

Mobile-first, **offline-first** inventory management PWA. Track products, stock in/out,
costs, tax, and earnings/profit per item — from your phone, online or offline.

> Full design & rationale: [`StockDesk-SSOT.md`](./StockDesk-SSOT.md) (single source of truth).

## What's built (Phase A MVP)

- **Products** — create/edit with photo, barcode, SKU, sell price, per-product tax rate, reorder point.
- **Barcode scanning** (camera, ZXing) — scan to look up, then Receive / Sell / Adjust; unknown codes prompt "add product".
- **Stock movements** — append-only ledger. Receive (purchase), Sell, Adjust, Loss.
- **Costing** — moving weighted average cost; COGS captured at sale time.
- **Tax/VAT** — per-sale output tax, per-purchase input tax, net liability; profit always on net (ex-tax) revenue.
- **Customers / Suppliers / Categories** — basic lookups; optional customer on sales.
- **Dashboard** — stock value, low-stock count, 7-day revenue/profit/tax, recent activity.
- **Reports** — profit by product, reorder list, tax summary, CSV export (7/30/90/365-day windows).
- **Offline-first** — all data lives in IndexedDB (Dexie); the app works with no network and no backend.
- **PWA** — installable, service worker precaching (production builds).

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

Open on your phone (same network) at the printed Network URL, or use Chrome DevTools
device mode. On first load, tap **Load sample data** on the dashboard to explore.

```bash
npm run build    # production build
npm start        # serve production build (service worker active)
npm run typecheck
```

## Cloud sync (optional — off by default)

The app is fully functional with **no backend**. To enable cloud backup + multi-device sync:

1. Create a Supabase project (do this yourself — none is auto-created).
2. Run the migration in [`supabase/migrations/`](./supabase/migrations/) against it
   (Supabase SQL editor or `supabase db push`).
3. Add keys to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
4. Restart. Pending local changes flush automatically when online; the schema's
   triggers re-compute on-hand / avg-cost / COGS / tax server-side, and RLS scopes
   every row to the signed-in owner.

## Tech

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · Dexie (IndexedDB) ·
dexie-react-hooks · ZXing · Serwist (PWA) · Supabase (optional).

## Structure

```
src/
  app/                 routes (dashboard, products, scan, movements, reports, settings)
  components/          UI primitives, BottomNav, Sheet, Scanner, MovementForm, ProductForm
  lib/
    types.ts           domain types
    inventory.ts       costing + tax math (mirrors DB triggers)
    db.ts              Dexie schema
    repo.ts            all writes (apply math + enqueue sync)
    hooks.ts           reactive reads (useLiveQuery)
    sync.ts            outbox flush to Supabase
    supabase.ts        client (no-op if no keys)
    seed.ts            sample data
supabase/migrations/   Postgres schema, triggers, views, RLS
```
