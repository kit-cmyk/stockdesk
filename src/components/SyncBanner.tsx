"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOnline, useOutboxStatus } from "@/lib/hooks";
import { isCloudEnabled } from "@/lib/supabase";
import { isAuthRoute } from "./Sidebar";

/**
 * Global sync status strip (SSOT §7/§8): "Offline — N pending" while
 * disconnected, a syncing hint while queued writes flush, and a warning when
 * entries were permanently rejected by the server.
 */
export function SyncBanner() {
  const pathname = usePathname();
  const online = useOnline();
  const status = useOutboxStatus();

  if (isAuthRoute(pathname)) return null;
  if (!status) return null;

  if (!online) {
    return (
      <div className="bg-warning/15 px-4 py-1.5 text-center text-xs font-semibold text-warning">
        Offline — {status.pending > 0 ? `${status.pending} pending change${status.pending === 1 ? "" : "s"} queued` : "changes will be queued"}
      </div>
    );
  }

  if (status.failed > 0) {
    return (
      <Link
        href="/settings"
        className="block bg-danger/15 px-4 py-1.5 text-center text-xs font-semibold text-danger"
      >
        {status.failed} change{status.failed === 1 ? "" : "s"} failed to sync — tap to review
      </Link>
    );
  }

  // Online with a healthy queue: only worth surfacing when cloud sync is on.
  if (isCloudEnabled && status.pending > 0) {
    return (
      <div className="bg-primary/10 px-4 py-1.5 text-center text-xs font-semibold text-primary">
        Syncing {status.pending} change{status.pending === 1 ? "" : "s"}…
      </div>
    );
  }

  return null;
}
