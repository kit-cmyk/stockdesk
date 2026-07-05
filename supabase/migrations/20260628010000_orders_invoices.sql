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
