"use client";

import { ProductForm } from "./ProductForm";
import { Sheet } from "./Sheet";
import type { Product, Profile } from "@/lib/types";

/** Product create/edit form presented in a side sheet. */
export function ProductFormSheet({
  open,
  onClose,
  profile,
  product,
  initialBarcode,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  product?: Product;
  initialBarcode?: string;
  onSaved?: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={product ? "Edit product" : "New product"} wide>
      <ProductForm
        profile={profile}
        product={product}
        initialBarcode={initialBarcode}
        onSaved={onSaved}
      />
    </Sheet>
  );
}
