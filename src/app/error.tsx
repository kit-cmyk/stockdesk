"use client";

// Route-level error boundary: every screen reads IndexedDB live, so a storage
// failure (private-mode Safari/Firefox, eviction) must land on a branded,
// recoverable screen instead of Next's raw client-exception page.

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 pt-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/15 text-xl">
        ⚠️
      </div>
      <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {error.message || "An unexpected error occurred."} Your data is stored on this device and is
        not lost.
      </p>
      <button
        onClick={reset}
        className="mt-5 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-fg"
      >
        Try again
      </button>
    </div>
  );
}
