"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { isAuthRoute } from "./Sidebar";

const tabs = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/products", label: "Products", icon: BoxIcon },
  { href: "/orders", label: "Orders", icon: CartIcon },
  { href: "/settings", label: "More", icon: MoreIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  if (isAuthRoute(pathname)) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md md:hidden">
      <div className="relative border-t border-border bg-bg/95 px-2 pb-safe pt-2 backdrop-blur">
        <div className="flex items-center justify-around">
          {tabs.slice(0, 2).map((t) => (
            <Tab key={t.href} {...t} active={isActive(pathname, t.href)} />
          ))}
          <div className="w-16" aria-hidden />
          {tabs.slice(2).map((t) => (
            <Tab key={t.href} {...t} active={isActive(pathname, t.href)} />
          ))}
        </div>
        <button
          onClick={() => router.push("/scan")}
          aria-label="Scan"
          className="absolute -top-6 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg ring-4 ring-bg active:brightness-95"
        >
          <ScanIcon />
        </button>
      </div>
    </nav>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function Tab({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: () => React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium",
        active ? "text-primary" : "text-muted"
      )}
    >
      <Icon />
      {label}
    </Link>
  );
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5 12 3l9 4.5v9L12 21 3 16.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.4 12.4a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L21 7H6" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}
function ScanIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M4 12h16" />
    </svg>
  );
}
