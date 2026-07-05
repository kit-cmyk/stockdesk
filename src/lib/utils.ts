import { v4 as uuidv4 } from "uuid";

export function newId(): string {
  return uuidv4();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatMoney(amount: number | null | undefined, currency = "USD"): string {
  const value = amount ?? 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat().format(n ?? 0);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------- Images ----------
// Product photos are stored as data URLs (Dexie + cloud sync), so we downscale
// and JPEG-compress on capture to keep rows small.

/** Draw an image/video frame scaled to fit `max` px on its long edge → JPEG data URL. */
export function scaleToJpeg(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  max = 1024,
  quality = 0.8
): string {
  const scale = Math.min(1, max / Math.max(srcW, srcH || 1));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Load a File into an HTMLImageElement (object URL revoked after load). */
export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

// ---------- SKU ----------

/**
 * Generate a human-ish SKU like "WIDG-7K3Q" from the product name (falls back to
 * "SKU"), with a random suffix. Retries until it doesn't collide with `existing`.
 */
export function generateSku(name: string, existing: Iterable<string> = []): string {
  const taken = new Set<string>();
  for (const s of existing) if (s) taken.add(s.toUpperCase());

  const prefix =
    (name.toUpperCase().match(/[A-Z0-9]+/g)?.join("").slice(0, 4) || "SKU").padEnd(3, "X");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  for (let attempt = 0; attempt < 50; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const candidate = `${prefix}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Extremely unlikely fallback.
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}
