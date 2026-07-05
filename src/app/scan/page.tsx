"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Scanner } from "@/components/Scanner";
import { Sheet } from "@/components/Sheet";
import { MovementForm } from "@/components/MovementForm";
import { ProductFormSheet } from "@/components/ProductFormSheet";
import { Badge, Button, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { archiveProduct, findByCode } from "@/lib/repo";
import { db } from "@/lib/db";
import { useProfile } from "@/lib/hooks";
import type { Product } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function ScanPage() {
  const router = useRouter();
  const profile = useProfile();
  const [found, setFound] = useState<Product | null>(null);
  const [missCode, setMissCode] = useState<string | null>(null);
  const [addBarcode, setAddBarcode] = useState<string | null>(null);
  const [mode, setMode] = useState<"sell" | "receive" | "adjust" | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function handleCode(code: string) {
    if (busy) return;
    setBusy(true);
    try {
      const product = await findByCode(code);
      if (product) {
        setFound(product);
      } else {
        setMissCode(code);
      }
    } finally {
      setTimeout(() => setBusy(false), 600);
    }
  }

  if (!profile) {
    return (
      <div className="px-4 pt-6">
        <Skeleton className="mb-4 h-8 w-32" />
        <Skeleton className="aspect-square w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Scan" subtitle="Point at a barcode to receive, sell, or look up" />
      <div className="px-4">
        <Scanner onResult={handleCode} />
      </div>

      {/* Found: quick action chooser */}
      <Sheet open={!!found && !mode} onClose={() => setFound(null)} title={found?.name}>
        {found && found.is_archived && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone="warning">Archived</Badge>
              <span className="text-sm text-muted">This product is out of circulation.</span>
            </div>
            <Button
              className="w-full"
              onClick={async () => {
                try {
                  await archiveProduct(found.id, false);
                  const fresh = await db.products.get(found.id);
                  if (fresh) setFound(fresh);
                  toast("Product restored", "success");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Failed to restore", "error");
                }
              }}
            >
              Restore product
            </Button>
            <button
              onClick={() => router.push(`/products/${found.id}`)}
              className="w-full pt-1 text-center text-sm text-primary"
            >
              Open product details →
            </button>
          </div>
        )}
        {found && !found.is_archived && (
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-2 p-3 text-sm ring-1 ring-border">
              <div className="flex justify-between">
                <span className="text-muted">On hand</span>
                <span className="font-semibold">
                  {found.quantity_on_hand} {found.unit}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Price</span>
                <span className="font-semibold">
                  {found.sell_price != null ? formatMoney(found.sell_price, profile.currency) : "—"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => setMode("sell")}>Sell</Button>
              <Button onClick={() => setMode("receive")}>Receive</Button>
              <Button variant="secondary" onClick={() => setMode("adjust")}>
                Adjust
              </Button>
            </div>
            <button
              onClick={() => {
                router.push(`/products/${found.id}`);
              }}
              className="w-full pt-1 text-center text-sm text-primary"
            >
              Open product details →
            </button>
          </div>
        )}
      </Sheet>

      {/* Found + chosen action */}
      <Sheet
        open={!!found && !!mode}
        onClose={() => {
          setMode(null);
          setFound(null);
        }}
        title={mode === "sell" ? "Record sale" : mode === "receive" ? "Receive stock" : "Adjust stock"}
      >
        {found && mode && (
          <MovementForm
            mode={mode}
            product={found}
            profile={profile}
            onDone={() => {
              setMode(null);
              setFound(null);
            }}
          />
        )}
      </Sheet>

      {/* Miss: offer to add */}
      <Sheet open={!!missCode} onClose={() => setMissCode(null)} title="No product found">
        {missCode && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Barcode <span className="font-mono text-text">{missCode}</span> isn&apos;t in your catalog yet.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setAddBarcode(missCode);
                setMissCode(null);
              }}
            >
              Add as new product
            </Button>
          </div>
        )}
      </Sheet>

      {/* Add a new product for an unrecognized barcode */}
      <ProductFormSheet
        open={!!addBarcode}
        onClose={() => setAddBarcode(null)}
        profile={profile}
        initialBarcode={addBarcode ?? undefined}
        onSaved={async (id) => {
          setAddBarcode(null);
          // SSOT journey 2: save -> continue receive for the just-created product.
          const product = await db.products.get(id);
          if (product) {
            setFound(product);
            setMode("receive");
          } else {
            router.push(`/products/${id}`);
          }
        }}
      />
    </div>
  );
}
