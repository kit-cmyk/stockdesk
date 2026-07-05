import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 pt-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-xl">
        🔍
      </div>
      <h1 className="mt-4 text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted">That link doesn&apos;t exist in StockDesk.</p>
      <Link
        href="/"
        className="mt-5 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-fg"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
