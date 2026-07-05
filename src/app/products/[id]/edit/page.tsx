"use client";

import { useParams, useRouter } from "next/navigation";
import { DetailSkeleton } from "@/components/ui";
import { ProductFormSheet } from "@/components/ProductFormSheet";
import { useProduct, useProfile } from "@/lib/hooks";

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const profile = useProfile();
  const product = useProduct(params.id);

  if (!profile || product === undefined) return <DetailSkeleton />;
  if (!product) return <div className="px-4 pt-10 text-center text-muted">Product not found.</div>;

  return (
    <ProductFormSheet
      open
      onClose={() => router.back()}
      profile={profile}
      product={product}
      onSaved={(id) => router.replace(`/products/${id}`)}
    />
  );
}
