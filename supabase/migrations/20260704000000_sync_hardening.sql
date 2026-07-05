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
-- Net revenue: inclusive prices carve tax out of the entered price; exclusive
-- prices ARE the net amount (tax sits on top). Missing snapshot = inclusive.
create or replace view public.v_movement_ledger as
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

create or replace view public.v_product_metrics as
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

create or replace view public.v_dashboard_summary as
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

create or replace view public.v_tax_summary as
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
