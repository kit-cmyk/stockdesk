"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Side sheet: slides in from the right edge. Full-width on mobile, a fixed
 * panel on larger screens. Sticky padded header with a close button and a
 * scrollable body so any form fits comfortably.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-overlay absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-side relative z-10 flex h-full w-full flex-col bg-surface shadow-2xl ring-1 ring-border",
          wide ? "sm:max-w-xl" : "sm:max-w-md"
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-lg font-bold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-text"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 pb-safe">{children}</div>
      </div>
    </div>
  );
}
