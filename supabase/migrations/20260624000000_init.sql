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
