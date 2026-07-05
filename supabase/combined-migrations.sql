-- StockDesk initial schema. Mirrors the SSOT (§5).
-- Single owner per row via owner_id = auth.uid(); RLS enforces isolation.
-- Quantities are integers (whole units). Money numeric(12,2). Tax rates numeric(5,2).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  currency text not null default 'USD',
  low_stock_default integer not null default 0,
  tax_label text not null default 'VAT',
  default_tax_rate numeric(5,2) not null default 0,
  prices_tax_inclusive boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories / suppliers / customers
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  contact text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- products (denormalized avg_cost + quantity_on_hand, maintained by trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sku text,
  barcode text,
  name text not null,
  description text,
  category_id uuid references public.categories (id) on delete set null,
  default_supplier_id uuid references public.suppliers (id) on delete set null,
  unit text not null default 'pc',
  image_path text,
  sell_price numeric(12,2),
  tax_rate numeric(5,2),
  avg_cost numeric(12,4) not null default 0,
  quantity_on_hand integer not null default 0,
  reorder_point integer,
  reorder_qty integer,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_owner_barcode on public.products (owner_id, barcode);
create unique index if not exists uq_products_owner_sku on public.products (owner_id, sku) where sku is not null;
create index if not exists idx_products_owner_name on public.products (owner_id, name);
create index if not exists idx_products_owner_archived on public.products (owner_id, is_archived);

-- ---------------------------------------------------------------------------
-- stock_movements (append-only ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  type text not null check (type in
    ('opening','purchase','sale','adjustment','return_in','return_out','loss','transfer')),
  quantity_delta integer not null,
  unit_cost numeric(12,4),
  unit_price numeric(12,2),
  tax_rate numeric(5,2),
  tax_amount numeric(12,2),
  cogs_unit numeric(12,4),
  supplier_id uuid references public.suppliers (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  reference text,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_movements_owner_client on public.stock_movements (owner_id, client_id);
create index if not exists idx_movements_product_date on public.stock_movements (owner_id, product_id, occurred_at desc);
create index if not exists idx_movements_type_date on public.stock_movements (owner_id, type, occurred_at);

-- ---------------------------------------------------------------------------
-- stock_counts / stock_count_items (Phase B — recount sessions)
-- ---------------------------------------------------------------------------
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note text,
  status text not null default 'open' check (status in ('open','committed')),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  expected_qty integer not null default 0,
  counted_qty integer,
  updated_at timestamptz not null default now()
);

create index if not exists idx_count_items_count on public.stock_count_items (owner_id, count_id);

-- ---------------------------------------------------------------------------
-- Trigger: maintain quantity_on_hand, avg_cost, cogs_unit, tax_amount
-- This is the server-side authority for the same math in src/lib/inventory.ts.
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prof record;
  prod record;
  rate numeric(5,2);
  inclusive boolean;
  line_total numeric(14,4);
  inbound boolean;
begin
  select * into prod from public.products where id = new.product_id for update;
  if not found then
    raise exception 'product % not found', new.product_id;
  end if;

  select * into prof from public.profiles where id = new.owner_id;

  inbound := new.quantity_delta > 0;
  rate := coalesce(new.tax_rate, prod.tax_rate, prof.default_tax_rate, 0);
  inclusive := coalesce(prof.prices_tax_inclusive, true);

  -- Moving weighted average on inbound with a known cost.
  if inbound and new.unit_cost is not null then
    if (prod.quantity_on_hand + new.quantity_delta) > 0 then
      update public.products
        set avg_cost = round(
              (prod.quantity_on_hand * prod.avg_cost + new.quantity_delta * new.unit_cost)
              / (prod.quantity_on_hand + new.quantity_delta), 4)
        where id = prod.id;
    else
      update public.products set avg_cost = round(new.unit_cost, 4) where id = prod.id;
    end if;
  end if;

  -- Capture COGS on outflow (avg_cost unchanged by outflows).
  if new.quantity_delta < 0 then
    new.cogs_unit := prod.avg_cost;
  end if;

  -- Tax: output tax on sales, input tax on purchases.
  if new.type = 'sale' and new.unit_price is not null then
    new.tax_rate := rate;
    line_total := abs(new.quantity_delta) * new.unit_price;
    if inclusive then
      new.tax_amount := round(line_total - line_total / (1 + rate/100), 2);
    else
      new.tax_amount := round(line_total * rate/100, 2);
    end if;
  elsif new.type = 'purchase' and new.unit_cost is not null then
    new.tax_rate := rate;
    line_total := abs(new.quantity_delta) * new.unit_cost; -- unit_cost is ex-tax
    new.tax_amount := round(line_total * rate/100, 2);
  end if;

  -- Apply the quantity change.
  update public.products
    set quantity_on_hand = quantity_on_hand + new.quantity_delta,
        updated_at = now()
    where id = prod.id;

  return new;
end;
$$;

drop trigger if exists trg_apply_movement on public.stock_movements;
create trigger trg_apply_movement
  before insert on public.stock_movements
  for each row execute function public.fn_apply_movement();

-- Keep updated_at fresh on editable tables.
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
create or replace view public.v_movement_ledger as
select
  m.*,
  p.name as product_name,
  c.name as customer_name,
  case when m.type = 'sale' then abs(m.quantity_delta) else 0 end as units_sold,
  case when m.type = 'sale' and m.unit_price is not null
       then round(abs(m.quantity_delta) * m.unit_price, 2) else 0 end as gross_revenue,
  case when m.type = 'sale' and m.unit_price is not null
       then round(abs(m.quantity_delta) * m.unit_price - coalesce(m.tax_amount,0), 2) else 0 end as net_revenue,
  case when m.type = 'sale' and m.cogs_unit is not null
       then round(abs(m.quantity_delta) * m.cogs_unit, 2) else 0 end as cogs,
  case when m.type = 'sale'
       then round(abs(m.quantity_delta) * m.unit_price - coalesce(m.tax_amount,0)
                  - abs(m.quantity_delta) * coalesce(m.cogs_unit,0), 2) else 0 end as profit
from public.stock_movements m
join public.products p on p.id = m.product_id
left join public.customers c on c.id = m.customer_id;

create or replace view public.v_product_metrics as
select
  p.id, p.owner_id, p.name, p.quantity_on_hand, p.avg_cost, p.sell_price,
  round(p.quantity_on_hand * p.avg_cost, 2) as stock_value,
  coalesce(s.units_sold_30d, 0) as units_sold_30d,
  coalesce(s.net_revenue_30d, 0) as net_revenue_30d,
  coalesce(s.profit_30d, 0) as profit_30d
from public.products p
left join (
  select product_id,
    sum(case when type='sale' then abs(quantity_delta) else 0 end) as units_sold_30d,
    sum(case when type='sale' then round(abs(quantity_delta)*unit_price - coalesce(tax_amount,0),2) else 0 end) as net_revenue_30d,
    sum(case when type='sale' then round(abs(quantity_delta)*unit_price - coalesce(tax_amount,0) - abs(quantity_delta)*coalesce(cogs_unit,0),2) else 0 end) as profit_30d
  from public.stock_movements
  where occurred_at >= now() - interval '30 days'
  group by product_id
) s on s.product_id = p.id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own suppliers" on public.suppliers;
create policy "own suppliers" on public.suppliers
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own customers" on public.customers;
create policy "own customers" on public.customers
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own products" on public.products;
create policy "own products" on public.products
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own movements" on public.stock_movements;
create policy "own movements" on public.stock_movements
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own stock_counts" on public.stock_counts;
create policy "own stock_counts" on public.stock_counts
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own stock_count_items" on public.stock_count_items;
create policy "own stock_count_items" on public.stock_count_items
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Auto-create a profile row on signup.
create or replace function public.fn_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, 'My Store')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();
-- Add free-text brand to products. Used for the brand filter on the products list.
alter table public.products
  add column if not exists brand text;

create index if not exists idx_products_owner_brand
  on public.products (owner_id, brand)
  where brand is not null;
-- StockDesk customer-management: orders, invoices, payments.
-- Orders sit on top of the append-only stock_movements ledger: confirming an
-- order posts one `sale` movement per line (client-side via recordMovement), so
-- stock/avg_cost/COGS/tax stay authoritative. Invoices/payments are a separate
-- accounts-receivable layer that never touches stock.

-- Profile additions for the invoice document header & A/R defaults.
alter table public.profiles add column if not exists business_address text;
alter table public.profiles add column if not exists tax_number text;
alter table public.profiles add column if not exists invoice_due_days integer not null default 0;

-- Link a posted sale movement back to the order that created it.
alter table public.stock_movements add column if not exists order_id uuid;
create index if not exists idx_movements_owner_order on public.stock_movements (owner_id, order_id);
create index if not exists idx_movements_owner_customer on public.stock_movements (owner_id, customer_id);

-- ---------------------------------------------------------------------------
-- orders / order_items
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null,
  customer_id uuid references public.customers (id) on delete set null,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  subtotal numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  note text,
  occurred_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, order_no)
);

create index if not exists idx_orders_owner_status on public.orders (owner_id, status, created_at desc);
create index if not exists idx_orders_owner_customer on public.orders (owner_id, customer_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null,
  unit_price numeric(12,2) not null,
  tax_rate numeric(5,2),
  cogs_unit numeric(12,4),
  movement_id uuid references public.stock_movements (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items (owner_id, order_id);

-- ---------------------------------------------------------------------------
-- invoices / payments (accounts receivable)
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invoice_no text not null,
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  status text not null default 'unpaid' check (status in ('unpaid','partial','paid','void')),
  subtotal numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, invoice_no)
);

create index if not exists idx_invoices_owner_status on public.invoices (owner_id, status, issued_at desc);
create index if not exists idx_invoices_owner_customer on public.invoices (owner_id, customer_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric(12,2) not null,
  method text,
  note text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_invoice on public.payments (owner_id, invoice_id);

-- ---------------------------------------------------------------------------
-- Trigger: keep invoice.amount_paid + status in sync with its payments.
-- Mirrors deriveInvoiceStatus() in src/lib/repo.ts.
-- ---------------------------------------------------------------------------
create or replace function public.fn_recalc_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv_id uuid;
  paid numeric(12,2);
  tot numeric(12,2);
  cur_status text;
begin
  inv_id := coalesce(new.invoice_id, old.invoice_id);
  select total, status into tot, cur_status from public.invoices where id = inv_id;
  if not found then
    return coalesce(new, old);
  end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = inv_id;
  update public.invoices
    set amount_paid = paid,
        status = case
          when cur_status = 'void' then 'void'
          when paid >= tot then 'paid'
          when paid > 0 then 'partial'
          else 'unpaid'
        end,
        updated_at = now()
    where id = inv_id;
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_payments_recalc on public.payments;
create trigger trg_payments_recalc
  after insert or update or delete on public.payments
  for each row execute function public.fn_recalc_invoice();

-- Keep updated_at fresh on editable tables.
drop trigger if exists trg_orders_touch on public.orders;
create trigger trg_orders_touch before update on public.orders
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_invoices_touch on public.invoices;
create trigger trg_invoices_touch before update on public.invoices
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

drop policy if exists "own orders" on public.orders;
create policy "own orders" on public.orders
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own order_items" on public.order_items;
create policy "own order_items" on public.order_items
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own invoices" on public.invoices;
create policy "own invoices" on public.invoices
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Sync hardening + SSOT catch-up (gap audit 2026-07-04).
--
-- 1. stock_movements.tax_inclusive — snapshot of profiles.prices_tax_inclusive
--    at sale time, so net revenue stays correct if the profile flag changes.
-- 2. Idempotent movement inserts: the client now inserts with
--    ON CONFLICT (owner_id, client_id) DO NOTHING. Product side effects move
--    from the BEFORE INSERT trigger to an AFTER INSERT trigger, which does NOT
--    fire for conflict-skipped rows — a re-sent movement can no longer apply
--    its quantity delta twice (audit B4).
-- 3. Ledger immutability: block UPDATE/DELETE on stock_movements (SSOT §5
--    trigger rule 3; audit E7). Corrections are new compensating movements.
-- 4. Views: add v_dashboard_summary + v_tax_summary, extend v_product_metrics,
--    and make v_movement_ledger's derived figures honor tax_inclusive (§5).

-- ---------------------------------------------------------------------------
-- 1. Pricing-mode snapshot
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists tax_inclusive boolean;

-- ---------------------------------------------------------------------------
-- 2. Split the movement trigger: BEFORE computes fields, AFTER applies stock
-- ---------------------------------------------------------------------------
create or replace function public.fn_movement_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prof record;
  prod record;
  rate numeric(5,2);
  inclusive boolean;
  line_total numeric(14,4);
begin
  -- Lock the product row for the whole statement so the AFTER trigger applies
  -- against the same state this computation observed.
  select * into prod from public.products where id = new.product_id for update;
  if not found then
    raise exception 'product % not found', new.product_id;
  end if;

  select * into prof from public.profiles where id = new.owner_id;

  rate := coalesce(new.tax_rate, prod.tax_rate, prof.default_tax_rate, 0);
  inclusive := coalesce(new.tax_inclusive, prof.prices_tax_inclusive, true);

  -- Capture COGS on outflow (avg_cost unchanged by outflows).
  if new.quantity_delta < 0 then
    new.cogs_unit := prod.avg_cost;
  end if;

  -- Tax: output tax on sales, input tax on purchases.
  if new.type = 'sale' and new.unit_price is not null then
    new.tax_rate := rate;
    new.tax_inclusive := inclusive;
    line_total := abs(new.quantity_delta) * new.unit_price;
    if inclusive then
      new.tax_amount := round(line_total - line_total / (1 + rate/100), 2);
    else
      new.tax_amount := round(line_total * rate/100, 2);
    end if;
  elsif new.type = 'purchase' and new.unit_cost is not null then
    new.tax_rate := rate;
    line_total := abs(new.quantity_delta) * new.unit_cost; -- unit_cost is ex-tax
    new.tax_amount := round(line_total * rate/100, 2);
  end if;

  return new;
end;
$$;

-- Applies stock/AVCO only for rows that were actually inserted (AFTER INSERT
-- does not fire for rows skipped by ON CONFLICT DO NOTHING).
create or replace function public.fn_movement_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prod record;
begin
  select * into prod from public.products where id = new.product_id for update;
  if not found then
    return new;
  end if;

  -- Moving weighted average on inbound with a known cost.
  if new.quantity_delta > 0 and new.unit_cost is not null then
    if (prod.quantity_on_hand + new.quantity_delta) > 0 then
      update public.products
        set avg_cost = round(
              (prod.quantity_on_hand * prod.avg_cost + new.quantity_delta * new.unit_cost)
              / (prod.quantity_on_hand + new.quantity_delta), 4)
        where id = prod.id;
    else
      update public.products set avg_cost = round(new.unit_cost, 4) where id = prod.id;
    end if;
  end if;

  update public.products
    set quantity_on_hand = quantity_on_hand + new.quantity_delta,
        updated_at = now()
    where id = prod.id;

  return new;
end;
$$;

drop trigger if exists trg_apply_movement on public.stock_movements;
drop trigger if exists trg_movement_before_insert on public.stock_movements;
drop trigger if exists trg_movement_after_insert on public.stock_movements;

create trigger trg_movement_before_insert
  before insert on public.stock_movements
  for each row execute function public.fn_movement_before_insert();

create trigger trg_movement_after_insert
  after insert on public.stock_movements
  for each row execute function public.fn_movement_after_insert();

-- The combined legacy function is superseded.
drop function if exists public.fn_apply_movement();

-- ---------------------------------------------------------------------------
-- 3. Immutable ledger — corrections are compensating movements
-- ---------------------------------------------------------------------------
create or replace function public.fn_block_movement_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_movements is append-only: record a compensating movement instead';
end;
$$;

drop trigger if exists trg_movements_immutable on public.stock_movements;
create trigger trg_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.fn_block_movement_mutation();

-- ---------------------------------------------------------------------------
-- 4. Views
-- ---------------------------------------------------------------------------
-- The ledger view selects m.* and the table gained columns (order_id,
-- tax_inclusive) since it was first created — CREATE OR REPLACE VIEW cannot
-- change column order, so drop and recreate (dependents first).
drop view if exists public.v_product_metrics;
drop view if exists public.v_dashboard_summary;
drop view if exists public.v_tax_summary;
drop view if exists public.v_movement_ledger;

-- Net revenue: inclusive prices carve tax out of the entered price; exclusive
-- prices ARE the net amount (tax sits on top). Missing snapshot = inclusive.
create view public.v_movement_ledger as
select
  m.*,
  p.name as product_name,
  c.name as customer_name,
  case when m.type = 'sale' then abs(m.quantity_delta) else 0 end as units_sold,
  case when m.type = 'sale' and m.unit_price is not null
       then round(abs(m.quantity_delta) * m.unit_price
                  + case when coalesce(m.tax_inclusive, true) then 0 else coalesce(m.tax_amount, 0) end, 2)
       else 0 end as gross_revenue,
  case when m.type = 'sale' and m.unit_price is not null
       then round(abs(m.quantity_delta) * m.unit_price
                  - case when coalesce(m.tax_inclusive, true) then coalesce(m.tax_amount, 0) else 0 end, 2)
       else 0 end as net_revenue,
  case when m.type = 'sale' and m.cogs_unit is not null
       then round(abs(m.quantity_delta) * m.cogs_unit, 2) else 0 end as cogs,
  case when m.type = 'sale'
       then round(abs(m.quantity_delta) * m.unit_price
                  - case when coalesce(m.tax_inclusive, true) then coalesce(m.tax_amount, 0) else 0 end
                  - abs(m.quantity_delta) * coalesce(m.cogs_unit, 0), 2)
       else 0 end as profit
from public.stock_movements m
join public.products p on p.id = m.product_id
left join public.customers c on c.id = m.customer_id;

create view public.v_product_metrics as
select
  p.id, p.owner_id, p.name, p.quantity_on_hand, p.avg_cost, p.sell_price,
  round(p.quantity_on_hand * p.avg_cost, 2) as stock_value,
  case when p.sell_price is not null and p.sell_price <> 0
       then round((p.sell_price - p.avg_cost) / p.sell_price * 100, 2) end as margin_pct,
  coalesce(s30.units_sold, 0) as units_sold_30d,
  coalesce(s90.units_sold, 0) as units_sold_90d,
  coalesce(s30.net_revenue, 0) as net_revenue_30d,
  coalesce(s30.cogs, 0) as cogs_30d,
  coalesce(s30.profit, 0) as profit_30d,
  coalesce(s30.output_tax, 0) as output_tax_30d,
  case when coalesce(s30.units_sold, 0) + p.quantity_on_hand > 0
       then round(coalesce(s30.units_sold, 0)::numeric
                  / (coalesce(s30.units_sold, 0) + greatest(p.quantity_on_hand, 0)) * 100, 1)
       else 0 end as sell_through_rate,
  case when coalesce(s30.units_sold, 0) > 0
       then round(p.quantity_on_hand / (coalesce(s30.units_sold, 0) / 30.0), 1) end as days_of_inventory,
  (p.quantity_on_hand <= coalesce(p.reorder_point, prof.low_stock_default, 0)
   and coalesce(p.reorder_point, prof.low_stock_default, 0) > 0)
  or p.quantity_on_hand < 0 as is_low_stock
from public.products p
left join public.profiles prof on prof.id = p.owner_id
left join (
  select product_id,
    sum(units_sold) as units_sold,
    sum(net_revenue) as net_revenue,
    sum(cogs) as cogs,
    sum(profit) as profit,
    sum(case when type = 'sale' then coalesce(tax_amount, 0) else 0 end) as output_tax
  from public.v_movement_ledger
  where occurred_at >= now() - interval '30 days'
  group by product_id
) s30 on s30.product_id = p.id
left join (
  select product_id, sum(units_sold) as units_sold
  from public.v_movement_ledger
  where occurred_at >= now() - interval '90 days'
  group by product_id
) s90 on s90.product_id = p.id;

create view public.v_dashboard_summary as
select
  p.owner_id,
  count(*) filter (where not p.is_archived) as sku_count,
  round(sum(p.quantity_on_hand * p.avg_cost) filter (where not p.is_archived), 2) as total_stock_value,
  count(*) filter (
    where not p.is_archived
      and ((p.quantity_on_hand <= coalesce(p.reorder_point, prof.low_stock_default, 0)
            and coalesce(p.reorder_point, prof.low_stock_default, 0) > 0)
           or p.quantity_on_hand < 0)
  ) as low_stock_count,
  coalesce(s.net_today, 0) as net_revenue_today,
  coalesce(s.profit_today, 0) as profit_today,
  coalesce(s.net_7d, 0) as net_revenue_7d,
  coalesce(s.profit_7d, 0) as profit_7d,
  coalesce(s.net_30d, 0) as net_revenue_30d,
  coalesce(s.profit_30d, 0) as profit_30d,
  coalesce(s.tax_30d, 0) as tax_collected_30d,
  coalesce(s.units_30d, 0) as units_moved_30d
from public.products p
left join public.profiles prof on prof.id = p.owner_id
left join (
  select owner_id,
    round(sum(net_revenue) filter (where occurred_at >= date_trunc('day', now())), 2) as net_today,
    round(sum(profit) filter (where occurred_at >= date_trunc('day', now())), 2) as profit_today,
    round(sum(net_revenue) filter (where occurred_at >= now() - interval '7 days'), 2) as net_7d,
    round(sum(profit) filter (where occurred_at >= now() - interval '7 days'), 2) as profit_7d,
    round(sum(net_revenue) filter (where occurred_at >= now() - interval '30 days'), 2) as net_30d,
    round(sum(profit) filter (where occurred_at >= now() - interval '30 days'), 2) as profit_30d,
    round(sum(case when type = 'sale' and occurred_at >= now() - interval '30 days'
                   then coalesce(tax_amount, 0) else 0 end), 2) as tax_30d,
    sum(abs(quantity_delta)) filter (where occurred_at >= now() - interval '30 days') as units_30d
  from public.v_movement_ledger
  group by owner_id
) s on s.owner_id = p.owner_id
group by p.owner_id, s.net_today, s.profit_today, s.net_7d, s.profit_7d,
         s.net_30d, s.profit_30d, s.tax_30d, s.units_30d;

create view public.v_tax_summary as
select
  owner_id,
  date_trunc('month', occurred_at) as period,
  round(sum(case when type = 'sale' then coalesce(tax_amount, 0) else 0 end), 2) as output_tax,
  round(sum(case when type = 'purchase' then coalesce(tax_amount, 0) else 0 end), 2) as input_tax,
  round(sum(case when type = 'sale' then coalesce(tax_amount, 0)
                 when type = 'purchase' then -coalesce(tax_amount, 0)
                 else 0 end), 2) as net_tax_liability
from public.stock_movements
group by owner_id, date_trunc('month', occurred_at);
-- Profile settings: the person using the account, separate from the business
-- display_name. The avatar stays device-local (data URL) and is never synced.
alter table public.profiles
  add column if not exists owner_name text;
