"use client";

// App-wide auth gate: every launch lands on /login (or /signup) until a
// session exists — a real Supabase session when cloud is enabled, or the
// on-device demo session while it isn't. Auth pages themselves stay reachable.

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/auth";
import { isAuthRoute } from "./Sidebar";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signedIn, loading } = useSession();
  const onAuthPage = isAuthPage(pathname);

  useEffect(() => {
    if (loading) return;
    if (!signedIn && !onAuthPage) router.replace("/login");
  }, [loading, signedIn, onAuthPage, router]);

  // Auth pages render immediately (they handle their own signed-in redirect).
  if (onAuthPage) return <>{children}</>;

  // Resolving the session, or signed out and about to redirect: show a splash
  // instead of flashing app content.
  if (loading || !signedIn) return <Splash />;

  return <>{children}</>;
}

/** Only the four auth screens are reachable while signed out (not /welcome). */
function isAuthPage(pathname: string): boolean {
  return isAuthRoute(pathname) && !pathname.startsWith("/welcome");
}

function Splash() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-3">
      <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl bg-primary text-primary-fg">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
          <path d="M4 12h16" />
        </svg>
      </span>
      <span className="text-sm font-medium text-muted">StockDesk</span>
    </div>
  );
}
