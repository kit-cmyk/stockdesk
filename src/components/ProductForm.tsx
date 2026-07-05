"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "./ui";
import { useToast } from "./Toast";
import { Scanner } from "./Scanner";
import { CameraCapture } from "./CameraCapture";
import { Sheet } from "./Sheet";
import { saveProduct, type ProductInput } from "@/lib/repo";
import { useCategories, useProducts, useSuppliers } from "@/lib/hooks";
import type { Product, Profile } from "@/lib/types";
import { fileToImage, generateSku, scaleToJpeg } from "@/lib/utils";

export function ProductForm({
  profile,
  product,
  initialBarcode,
  onSaved,
}: {
  profile: Profile;
  product?: Product;
  initialBarcode?: string;
  /** Called with the saved product id. Defaults to navigating to its detail page. */
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const categories = useCategories();
  const suppliers = useSuppliers();
  const allProducts = useProducts({ includeArchived: true });
  const fileRef = useRef<HTMLInputElement>(null);

  // Distinct existing brands (for the searchable brand dropdown).
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProducts ?? []) if (p.brand) set.add(p.brand);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allProducts]);

  const [name, setName] = useState(product?.name ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? initialBarcode ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "pc");
  const [sellPrice, setSellPrice] = useState<string | number>(product?.sell_price ?? "");
  const [taxRate, setTaxRate] = useState<string | number>(product?.tax_rate ?? "");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [supplierId, setSupplierId] = useState(product?.default_supplier_id ?? "");
  const [reorderPoint, setReorderPoint] = useState<string | number>(product?.reorder_point ?? "");
  const [reorderQty, setReorderQty] = useState<string | number>(product?.reorder_qty ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  // All photos + which one is the thumbnail (shown in lists/grids).
  const initialPhotos = product?.images?.length
    ? product.images
    : product?.image_data
      ? [product.image_data]
      : [];
  const [photos, setPhotos] = useState<string[]>(initialPhotos);
  const [thumbIdx, setThumbIdx] = useState(() => {
    const i = product?.image_data ? initialPhotos.indexOf(product.image_data) : 0;
    return i >= 0 ? i : 0;
  });
  const [scanOpen, setScanOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function addPhoto(dataUrl: string) {
    setPhotos((prev) => [...prev, dataUrl]);
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, j) => j !== i));
    setThumbIdx((t) => (i === t ? 0 : i < t ? t - 1 : t));
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    if (files.length === 0) return;
    try {
      for (const file of files) {
        const img = await fileToImage(file);
        addPhoto(scaleToJpeg(img, img.naturalWidth, img.naturalHeight));
      }
      setPhotoOpen(false);
    } catch {
      toast("Could not read that image", "error");
    }
  }

  function generateNewSku() {
    const existing = (allProducts ?? []).map((p) => p.sku ?? "");
    setSku(generateSku(name, existing));
  }

  async function submit() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      // New products with no SKU get an auto-generated one.
      let finalSku = sku.trim();
      if (!finalSku && !product) {
        finalSku = generateSku(name, (allProducts ?? []).map((p) => p.sku ?? ""));
      }
      const input: ProductInput = {
        id: product?.id,
        name: name.trim(),
        barcode: barcode.trim() || undefined,
        sku: finalSku || undefined,
        unit,
        sell_price: sellPrice === "" ? undefined : Number(sellPrice),
        tax_rate: taxRate === "" ? undefined : Number(taxRate),
        brand: brand.trim() || undefined,
        category_id: categoryId || undefined,
        default_supplier_id: supplierId || undefined,
        reorder_point: reorderPoint === "" ? undefined : Math.trunc(Number(reorderPoint)),
        reorder_qty: reorderQty === "" ? undefined : Math.trunc(Number(reorderQty)),
        description: description.trim() || undefined,
        // null = photos explicitly removed (repo keeps existing only when undefined)
        image_data: photos[thumbIdx] ?? photos[0] ?? null,
        images: photos.length > 0 ? photos : null,
      };
      const id = await saveProduct(input);
      toast(product ? "Product updated" : "Product created", "success");
      if (onSaved) onSaved(id);
      else router.replace(`/products/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
      </Field>

      <Field
        label="Photos"
        hint={photos.length > 1 ? "Tap a photo to use it as the thumbnail" : undefined}
      >
        <div className="flex flex-wrap gap-2.5">
          {photos.map((src, i) => (
            <div key={i} className="relative">
              <button
                type="button"
                aria-label={i === thumbIdx ? "Thumbnail photo" : "Use as thumbnail"}
                aria-pressed={i === thumbIdx}
                onClick={() => setThumbIdx(i)}
                className={`block h-20 w-20 overflow-hidden rounded-2xl ring-2 transition ${
                  i === thumbIdx ? "ring-primary" : "ring-border hover:ring-primary/40"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
              {i === thumbIdx && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-2xl bg-primary/90 py-0.5 text-center text-[10px] font-semibold text-primary-fg">
                  Thumbnail
                </span>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => removePhoto(i)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white shadow ring-2 ring-surface"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-2xl bg-surface-2 text-xs font-medium text-muted ring-1 ring-border transition hover:text-text"
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Add
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPickImage} />
      </Field>

      <Field label="Barcode">
        <div className="flex gap-2">
          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or enter" inputMode="numeric" />
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => setScanOpen(true)}>
            Scan
          </Button>
        </div>
      </Field>

      <Field label="SKU" hint={!product ? "Auto-generated on save if left blank" : undefined}>
        <div className="flex gap-2">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" />
          <Button type="button" variant="secondary" className="shrink-0" onClick={generateNewSku}>
            Generate
          </Button>
        </div>
      </Field>

      <Field label="Unit">
        <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="pc">pc</option>
          <option value="box">box</option>
          <option value="pack">pack</option>
          <option value="set">set</option>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Sell price (${profile.prices_tax_inclusive ? "incl." : "excl."} ${profile.tax_label})`}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={`${profile.tax_label} % override`} hint={`Default: ${profile.default_tax_rate}%`}>
          <Input type="number" inputMode="decimal" min={0} max={100} step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="—" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— None —</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Brand" hint="Pick existing or type a new one">
          <Input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Search or add"
            list="brand-options"
            autoComplete="off"
          />
          <datalist id="brand-options">
            {brandOptions.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Default supplier">
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— None —</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Reorder point" hint="Low-stock alert">
          <Input type="number" inputMode="numeric" min={0} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} placeholder={String(profile.low_stock_default)} />
        </Field>
        <Field label="Reorder qty" hint="Suggested restock">
          <Input type="number" inputMode="numeric" min={0} value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} placeholder="—" />
        </Field>
      </div>

      <Field label="Description">
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes" />
      </Field>

      <Button className="w-full" onClick={submit} disabled={saving}>
        {saving ? "Saving…" : product ? "Save changes" : "Create product"}
      </Button>

      <Sheet open={photoOpen} onClose={() => setPhotoOpen(false)} title="Add photo">
        <CameraCapture
          onCapture={(dataUrl) => {
            addPhoto(dataUrl);
            setPhotoOpen(false);
            toast("Photo added", "success");
          }}
          onPickFile={() => fileRef.current?.click()}
        />
      </Sheet>

      <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title="Scan barcode">
        <Scanner
          onResult={(code) => {
            setBarcode(code);
            setScanOpen(false);
            toast("Barcode captured", "success");
          }}
        />
      </Sheet>
    </div>
  );
}
