"use client";

import { useEffect, useState } from "react";

/**
 * Fullscreen image lightbox. Closes on backdrop tap, the ✕ button, or Escape.
 * With more than one image, ‹ › buttons and arrow keys navigate; a counter
 * shows the position. Dependency-free; images scale to fit the viewport.
 */
export function ImageViewer({
  images,
  initialIndex = 0,
  alt = "",
  open,
  onClose,
}: {
  images: string[];
  initialIndex?: number;
  alt?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const count = images.length;

  // Re-anchor to the tapped image each time the viewer opens.
  useEffect(() => {
    if (open) setIdx(Math.min(Math.max(initialIndex, 0), Math.max(count - 1, 0)));
  }, [open, initialIndex, count]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (count > 1 && e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
      if (count > 1 && e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    // Lock background scroll while the viewer is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, count]);

  if (!open || count === 0) return null;

  const navBtn =
    "absolute top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Product image"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close image"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl text-white transition hover:bg-white/20"
      >
        ✕
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[idx]}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
      />

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i - 1 + count) % count);
            }}
            className={`${navBtn} left-3`}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i + 1) % count);
            }}
            className={`${navBtn} right-3`}
          >
            ›
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium tabular-nums text-white">
            {idx + 1} / {count}
          </span>
        </>
      )}
    </div>
  );
}
