-- Add free-text brand to products. Used for the brand filter on the products list.
alter table public.products
  add column if not exists brand text;

create index if not exists idx_products_owner_brand
  on public.products (owner_id, brand)
  where brand is not null;
