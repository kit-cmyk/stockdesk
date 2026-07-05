// Precached offline fallback (see src/app/sw.ts): shown when a navigation
// misses both the network and the pages cache.

export default function OfflineFallback() {
  return (
    <div className="px-4 pt-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-xl">
        📡
      </div>
      <h1 className="mt-4 text-lg font-semibold">You&apos;re offline</h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        This page isn&apos;t cached yet. Pages you&apos;ve visited before keep working offline, and
        anything you record is saved on this device and synced later.
      </p>
      <a
        href="/"
        className="mt-5 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-fg"
      >
        Go to dashboard
      </a>
    </div>
  );
}
