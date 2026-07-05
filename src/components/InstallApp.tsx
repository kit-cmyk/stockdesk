"use client";

import { useEffect, useState } from "react";

/** Chrome/Edge/Android fire this; it lets us trigger the native install prompt. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * Offer to install StockDesk as an offline app from the auth pages.
 *
 * - Chromium (Android/desktop): captures `beforeinstallprompt` and shows a
 *   one-tap install button that opens the browser's native install dialog.
 * - iOS Safari: no programmatic prompt exists, so we show the manual
 *   "Share → Add to Home Screen" steps instead.
 * - Already installed (running standalone): renders nothing.
 */
export function InstallApp() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);

  useEffect(() => {
    // Running as an installed PWA already? Then there's nothing to offer.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS exposes this non-standard flag when launched from the home screen.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent.toLowerCase();
    // iPadOS 13+ reports as a Mac, so also treat touch-capable "Macs" as iOS.
    const iOS =
      /iphone|ipad|ipod/.test(ua) ||
      (/macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    setIsIOS(iOS);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we drive the prompt ourselves
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferred(null); // the event can only be used once
  }

  // Nothing actionable to show: already installed, or a browser that supports
  // neither the install event nor iOS's manual flow.
  if (installed) return null;
  if (!deferred && !isIOS) return null;

  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <PhoneIcon />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">Use StockDesk offline</h3>
          <p className="mt-0.5 text-xs text-muted">
            Install the app on your phone to manage inventory anywhere — even with no connection.
          </p>
        </div>
      </div>

      {deferred ? (
        <button
          type="button"
          onClick={install}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg transition hover:brightness-110 active:brightness-95"
        >
          <DownloadIcon />
          Install app
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowIOSSteps((s) => !s)}
            aria-expanded={showIOSSteps}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold text-text ring-1 ring-border transition hover:bg-border"
          >
            <DownloadIcon />
            Add to Home Screen
          </button>
          {showIOSSteps && (
            <ol className="mt-3 space-y-1.5 text-xs text-muted">
              <li className="flex gap-2">
                <Step>1</Step>
                <span>
                  Tap the <span className="font-semibold text-text">Share</span> icon
                  <ShareGlyph /> in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex gap-2">
                <Step>2</Step>
                <span>
                  Choose <span className="font-semibold text-text">Add to Home Screen</span>.
                </span>
              </li>
              <li className="flex gap-2">
                <Step>3</Step>
                <span>
                  Tap <span className="font-semibold text-text">Add</span> — StockDesk opens like a
                  native app and works offline.
                </span>
              </li>
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
      {children}
    </span>
  );
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><path d="m7 11 5 4 5-4" /><path d="M5 21h14" />
    </svg>
  );
}
function ShareGlyph() {
  return (
    <svg className="mx-0.5 inline-block -translate-y-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4" /><path d="m8 8 4-4 4 4" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
    </svg>
  );
}
