"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isAuthRoute } from "./Sidebar";
import { useCustomers, useProducts, useProfile } from "@/lib/hooks";
import { useSession, signOut } from "@/lib/auth";
import { useToast } from "@/components/Toast";

type SearchHit =
  | { kind: "product"; id: string; title: string; sub?: string }
  | { kind: "customer"; id: string; title: string; sub?: string };

const MAX_PER_GROUP = 5;

/** Sticky app header: global search + profile menu. Hidden on auth routes. */
export function TopBar() {
  const pathname = usePathname();
  if (isAuthRoute(pathname)) return null;
  return <TopBarInner />;
}

function TopBarInner() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        {/* Brand — mobile only (desktop has it in the sidebar). */}
        <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="StockDesk home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <ScanIcon />
          </span>
        </Link>

        <GlobalSearch />
        <ProfileMenu />
      </div>
    </header>
  );
}

/* ---------------- Global search ---------------- */

function GlobalSearch() {
  const router = useRouter();
  const products = useProducts();
  const customers = useCustomers();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useClickOutside(wrapRef, () => setOpen(false));

  const hits = useMemo<SearchHit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const productHits: SearchHit[] = (products ?? [])
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.sku?.toLowerCase().includes(needle) ||
          p.barcode?.includes(needle) ||
          p.brand?.toLowerCase().includes(needle)
      )
      .slice(0, MAX_PER_GROUP)
      .map((p) => ({
        kind: "product" as const,
        id: p.id,
        title: p.name,
        sub: p.sku || p.brand || undefined,
      }));
    const customerHits: SearchHit[] = (customers ?? [])
      .filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.contact?.toLowerCase().includes(needle)
      )
      .slice(0, MAX_PER_GROUP)
      .map((c) => ({
        kind: "customer" as const,
        id: c.id,
        title: c.name,
        sub: c.contact || undefined,
      }));
    return [...productHits, ...customerHits];
  }, [q, products, customers]);

  function go(hit: SearchHit) {
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(hit.kind === "product" ? `/products/${hit.id}` : `/customers/${hit.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "Enter" && hits.length > 0) {
      e.preventDefault();
      go(hits[0]);
    }
  }

  const showPanel = open && q.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search products, customers…"
        aria-label="Search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        className="h-11 w-full rounded-xl bg-surface-2 pl-9 pr-3 text-base text-text ring-1 ring-border outline-none placeholder:text-muted focus:ring-2 focus:ring-primary"
      />

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-border"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              No matches for “{q.trim()}”
            </p>
          ) : (
            <>
              <SearchGroup label="Products" hits={hits.filter((h) => h.kind === "product")} onPick={go} />
              <SearchGroup label="Customers" hits={hits.filter((h) => h.kind === "customer")} onPick={go} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({
  label,
  hits,
  onPick,
}: {
  label: string;
  hits: SearchHit[];
  onPick: (h: SearchHit) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <div className="py-1">
      <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      {hits.map((h) => (
        <button
          key={`${h.kind}-${h.id}`}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onPick(h)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
            {h.kind === "product" ? <BoxIcon /> : <UserIcon />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-text">{h.title}</span>
            {h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Profile menu ---------------- */

function ProfileMenu() {
  const router = useRouter();
  const toast = useToast();
  const profile = useProfile();
  const { email: sessionEmail, cloudEnabled } = useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapRef, () => setOpen(false));

  const name = profile?.owner_name?.trim() || profile?.display_name?.trim() || "StockDesk";
  const email = sessionEmail ?? undefined;
  const avatar = profile?.avatar_data;
  const initials = useMemo(() => getInitials(name), [name]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      toast("Signed out", "success");
      router.push("/login");
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-fg ring-1 ring-border transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-border"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-fg">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">{name}</div>
              <div className="truncate text-xs text-muted">
                {email ?? (cloudEnabled ? "Not signed in" : "Local account")}
              </div>
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          <Link
            href="/settings/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-text transition hover:bg-surface-2"
          >
            <GearIcon />
            Profile settings
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
          >
            <LogoutIcon />
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Helpers ---------------- */

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Close a popover when the user clicks/taps outside of `ref`. */
function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handler(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onOutside]);
}

/* ---------------- Icons ---------------- */

function ScanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M4 12h16" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5 12 3l9 4.5v9L12 21 3 16.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.5 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 14.9 1.65 1.65 0 0 0 1.91 13.5H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 7.5a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 9.1V9a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
    </svg>
  );
}
