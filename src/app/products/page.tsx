"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FilterBar,
  FilterSelect,
  ListSkeleton,
  PageHeader,
  SearchInput,
} from "@/components/ui";
import { ProductFormSheet } from "@/components/ProductFormSheet";
import { useCategories, useProducts, useProfile } from "@/lib/hooks";
import { stockFlag, stockValue } from "@/lib/inventory";
import { formatMoney } from "@/lib/utils";

type SortKey = "name" | "qty-desc" | "qty-asc" | "value-desc" | "recent";
type StockFilter = "all" | "low" | "negative";
type ViewMode = "list" | "grid";

const VIEW_KEY = "stockdesk.products-view";

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const base = "flex h-9 w-9 items-center justify-center rounded-lg transition";
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-surface-2 p-0.5 ring-1 ring-border">
      <button
        type="button"
        aria-label="List view"
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
        className={`${base} ${view === "list" ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}
      >
        <ListIcon />
      </button>
      <button
        type="button"
        aria-label="Grid view"
        aria-pressed={view === "grid"}
        onClick={() => onChange("grid")}
        className={`${base} ${view === "grid" ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}
      >
        <GridIcon />
      </button>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<ListSkeleton className="pt-6" />}>
      <ProductsPageInner />
    </Suspense>
  );
}

function ProductsPageInner() {
  const searchParams = useSearchParams();
  const profile = useProfile();
  const products = useProducts();
  const categories = useCategories();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  // Dashboard low-stock cards deep-link here with ?filter=low (SSOT journey 4).
  const [stock, setStock] = useState<StockFilter>(
    searchParams.get("filter") === "low" ? "low" : "all"
  );
  const [addOpen, setAddOpen] = useState(false);
  // View preference persists across visits. Loaded in an effect (not the
  // initializer) so the statically prerendered page hydrates cleanly.
  const [view, setView] = useState<ViewMode>("list");
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "grid" || stored === "list") setView(stored);
  }, []);
  function changeView(v: ViewMode) {
    setView(v);
    window.localStorage.setItem(VIEW_KEY, v);
  }

  // Distinct brands actually present on products, for the brand filter.
  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const p of products ?? []) if (p.brand) set.add(p.brand);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const visible = useMemo(() => {
    if (!products || !profile) return [];
    const needle = q.trim().toLowerCase();
    const rows = products.filter((p) => {
      if (categoryId && p.category_id !== categoryId) return false;
      if (brand && p.brand !== brand) return false;
      if (stock === "low" && stockFlag(p, profile) === null) return false;
      if (stock === "negative" && p.quantity_on_hand >= 0) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.sku?.toLowerCase().includes(needle) ||
        p.barcode?.includes(needle) ||
        p.brand?.toLowerCase().includes(needle)
      );
    });
    const sorted = [...rows];
    switch (sort) {
      case "qty-desc":
        sorted.sort((a, b) => b.quantity_on_hand - a.quantity_on_hand);
        break;
      case "qty-asc":
        sorted.sort((a, b) => a.quantity_on_hand - b.quantity_on_hand);
        break;
      case "value-desc":
        sorted.sort((a, b) => stockValue(b) - stockValue(a));
        break;
      case "recent":
        sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [products, profile, q, categoryId, brand, stock, sort]);

  if (!profile || !products) {
    return (
      <div>
        <PageHeader title="Products" />
        <ListSkeleton />
      </div>
    );
  }

  const filtered = visible;
  const hasFilters = Boolean(q.trim() || categoryId || brand || stock !== "all");

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${filtered.length} of ${products.length} items`}
        action={<Button className="h-10 px-3" onClick={() => setAddOpen(true)}>+ Add</Button>}
      />

      <FilterBar>
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, SKU, barcode"
        />
        <FilterSelect
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          aria-label="Filter by brand"
          disabled={brands.length === 0}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          value={stock}
          onChange={(e) => setStock(e.target.value as StockFilter)}
          aria-label="Filter by stock level"
        >
          <option value="all">All stock</option>
          <option value="low">Low stock</option>
          <option value="negative">Negative stock</option>
        </FilterSelect>
        <FilterSelect
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort products"
        >
          <option value="name">Name A–Z</option>
          <option value="qty-desc">Qty: high → low</option>
          <option value="qty-asc">Qty: low → high</option>
          <option value="value-desc">Stock value</option>
          <option value="recent">Recently updated</option>
        </FilterSelect>
        <ViewToggle view={view} onChange={changeView} />
      </FilterBar>

      <div className={view === "grid" ? "mt-3 grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "mt-3 space-y-2 px-4"}>
        {filtered.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No matches" : "No products yet"}
            body={hasFilters ? "Try a different search or filter." : "Add your first product to get started."}
            action={!hasFilters && <Button onClick={() => setAddOpen(true)}>Add a product</Button>}
          />
        ) : view === "grid" ? (
          filtered.map((p) => {
            const flag = stockFlag(p, profile);
            const low = flag !== null;
            return (
              <Link
                key={p.id}
                href={`/products/${p.id}`}
                className="flex flex-col overflow-hidden rounded-2xl bg-surface ring-1 ring-border transition hover:ring-primary/40"
              >
                <div className="relative flex aspect-square w-full items-center justify-center bg-surface-2 text-3xl font-bold text-muted">
                  {p.image_data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_data} alt="" className="h-full w-full object-cover" />
                  ) : (
                    p.name.charAt(0).toUpperCase()
                  )}
                  <span
                    className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm ring-1 ring-border ${
                      flag === "negative"
                        ? "bg-danger text-white"
                        : low
                          ? "bg-warning text-white"
                          : "bg-surface/90 text-text"
                    }`}
                  >
                    {p.quantity_on_hand} {p.unit}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <span className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</span>
                  <span className="mt-auto pt-1 text-xs text-muted">
                    {p.sell_price != null ? formatMoney(p.sell_price, profile.currency) : "No price"}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </span>
                </div>
              </Link>
            );
          })
        ) : (
          filtered.map((p) => {
            const flag = stockFlag(p, profile);
            const low = flag !== null;
            return (
              <Link
                key={p.id}
                href={`/products/${p.id}`}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-lg font-bold text-muted">
                  {p.image_data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_data} alt="" className="h-full w-full object-cover" />
                  ) : (
                    p.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {flag === "negative" && <Badge tone="danger">Negative</Badge>}
                    {flag === "low" && <Badge tone="warning">Low</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {p.sell_price != null ? formatMoney(p.sell_price, profile.currency) : "No price"} ·{" "}
                    {formatMoney(stockValue(p), profile.currency)} value
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-lg font-bold tabular-nums ${flag === "negative" ? "text-danger" : low ? "text-warning" : "text-text"}`}>
                    {p.quantity_on_hand}
                  </div>
                  <div className="text-[10px] text-muted">{p.unit}</div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      <ProductFormSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        profile={profile}
        onSaved={() => setAddOpen(false)}
      />
    </div>
  );
}
