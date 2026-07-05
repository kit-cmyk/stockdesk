"use client";

import { useEffect } from "react";
import { ToastProvider } from "@/components/Toast";
import { ensureProfile } from "@/lib/db";
import { backfillCatalogImages } from "@/lib/seed";
import { syncNow } from "@/lib/sync";
import { isCloudEnabled } from "@/lib/supabase";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void ensureProfile();
    // Attach catalog photos to products seeded before photos existed (no-op
    // once done).
    void backfillCatalogImages();

    // Register the service worker (production build only).
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .then(async (reg) => {
          // Ask the browser to wake us when connectivity returns even if the
          // tab was closed (Background Sync; no-op where unsupported).
          try {
            const sync = (reg as ServiceWorkerRegistration & {
              sync?: { register: (tag: string) => Promise<void> };
            }).sync;
            await sync?.register("stockdesk-outbox");
          } catch {
            /* Background Sync unsupported — page-lifecycle flushing still applies */
          }
        })
        .catch(() => {});
    }

    // The service worker's `sync` event can't reach IndexedDB+Supabase logic
    // directly, so it pings the page to do the flush.
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "flush-outbox") void syncNow();
    };
    navigator.serviceWorker?.addEventListener?.("message", onSwMessage);

    // Sync (push + pull) on start and whenever connectivity returns.
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    void syncNow();

    // Retry timer: a transient failure while staying online would otherwise
    // wait for the next mutation. Cheap no-op when the outbox is empty.
    const interval = isCloudEnabled
      ? window.setInterval(() => {
          if (navigator.onLine) void syncNow();
        }, 60_000)
      : undefined;

    return () => {
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener?.("message", onSwMessage);
      if (interval) window.clearInterval(interval);
    };
  }, []);

  return <ToastProvider>{children}</ToastProvider>;
}
