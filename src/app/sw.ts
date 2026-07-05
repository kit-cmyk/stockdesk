/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // Offline app shell (SSOT §7/§10): navigations that miss both network and the
  // pages cache fall back to the precached offline document instead of the
  // browser's network-error page.
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

// Background Sync (SSOT §7): when connectivity returns, ask any open client to
// flush the outbox (the sync logic lives in the app, next to Dexie + Supabase).
self.addEventListener("sync", (event) => {
  const syncEvent = event as ExtendableEvent & { tag?: string };
  if (syncEvent.tag !== "stockdesk-outbox") return;
  syncEvent.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "flush-outbox" });
      }
    })()
  );
});
