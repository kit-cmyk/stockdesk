"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { createDraftOrder } from "@/lib/repo";

function NewOrderStarter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    setError(null);
    const customerId = searchParams.get("customer") ?? undefined;
    createDraftOrder(customerId)
      .then((id) => router.replace(`/orders/${id}`))
      .catch((e) => {
        started.current = false;
        setError(e instanceof Error ? e.message : "Could not start the order");
      });
  }, [router, searchParams]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  if (error) {
    return (
      <div className="px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Couldn&apos;t start the order</h1>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Button
          className="mt-4"
          onClick={() => {
            started.current = true;
            start();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return <div className="px-4 pt-6 text-muted">Starting order…</div>;
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-muted">Starting order…</div>}>
      <NewOrderStarter />
    </Suspense>
  );
}
