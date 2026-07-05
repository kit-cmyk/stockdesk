"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProductFormSheet } from "@/components/ProductFormSheet";
import { useProfile } from "@/lib/hooks";

function NewProductInner() {
  const profile = useProfile();
  const router = useRouter();
  const params = useSearchParams();
  const barcode = params.get("barcode") ?? undefined;
  if (!profile) return <div className="px-4 pt-6 text-muted">Loading…</div>;
  return (
    <ProductFormSheet
      open
      onClose={() => router.back()}
      profile={profile}
      initialBarcode={barcode}
      onSaved={(id) => router.replace(`/products/${id}`)}
    />
  );
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-muted">Loading…</div>}>
      <NewProductInner />
    </Suspense>
  );
}
