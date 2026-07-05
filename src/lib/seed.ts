import { db, ensureProfile, getMeta, setMeta } from "./db";
import { recordMovement, saveCategory, saveCustomer, saveProduct, saveSupplier } from "./repo";
import { PRICELIST } from "./pricelist-data";
import { PRICELIST_IMAGES } from "./pricelist-images";

/**
 * Fetch a bundled catalog photo and inline it as a data URL, matching how the
 * app stores product photos (`image_data` in IndexedDB → works offline).
 * Returns undefined when offline or the asset is missing — seeding proceeds
 * without the photo.
 */
async function fetchImageData(file: string): Promise<string | undefined> {
  try {
    const res = await fetch(`/catalog/${file}`);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * Load the real auto-parts catalog from the supplier pricelist into the local
 * database (categories + products + photos). Prices aren't in the source
 * pricelist, so sell prices start empty for the user to fill in.
 */
export async function seedPricelistData(): Promise<void> {
  await ensureProfile();
  for (let s = 0; s < PRICELIST.length; s++) {
    const section = PRICELIST[s];
    const categoryId = await saveCategory(section.category);
    // Pull this section's photos in parallel before the sequential writes.
    const images = await Promise.all(
      section.items.map((_, i) => {
        const file = PRICELIST_IMAGES[`${s}:${i}`];
        return file ? fetchImageData(file) : Promise.resolve(undefined);
      })
    );
    for (let i = 0; i < section.items.length; i++) {
      const [code, name, brand] = section.items[i];
      await saveProduct({
        name,
        sku: code ?? undefined,
        brand,
        category_id: categoryId,
        unit: "pc",
        image_data: images[i],
      });
    }
  }
}

const IMAGES_BACKFILL_FLAG = "catalog_images_backfilled";

/**
 * One-time backfill: attach catalog photos to products that were seeded
 * before photos existed (or whose photo download failed). Matches by SKU,
 * falling back to exact name for code-less items. `image_data` is a
 * device-local field (sync strips it), so rows are updated directly without
 * touching the outbox or `updated_at`.
 */
export async function backfillCatalogImages(): Promise<number> {
  if (typeof window === "undefined") return 0;
  if ((await getMeta(IMAGES_BACKFILL_FLAG)) === "1") return 0;
  if ((await db.products.count()) === 0) return 0; // nothing seeded yet

  const targets: { id: string; file: string }[] = [];
  for (let s = 0; s < PRICELIST.length; s++) {
    const items = PRICELIST[s].items;
    for (let i = 0; i < items.length; i++) {
      const file = PRICELIST_IMAGES[`${s}:${i}`];
      if (!file) continue;
      const [code, name] = items[i];
      const product = code
        ? await db.products.where("sku").equals(code).first()
        : await db.products.where("name").equals(name).first();
      if (!product || product.image_data) continue;
      targets.push({ id: product.id, file });
    }
  }
  if (targets.length === 0) {
    await setMeta(IMAGES_BACKFILL_FLAG, "1");
    return 0;
  }

  let updated = 0;
  let failures = 0;
  const CHUNK = 16;
  for (let at = 0; at < targets.length; at += CHUNK) {
    const chunk = targets.slice(at, at + CHUNK);
    const datas = await Promise.all(chunk.map((t) => fetchImageData(t.file)));
    for (let i = 0; i < chunk.length; i++) {
      if (!datas[i]) {
        failures++;
        continue;
      }
      await db.products.update(chunk[i].id, { image_data: datas[i] });
      updated++;
    }
  }
  // Only mark done when everything resolved — a failed fetch (offline, dev
  // server hiccup) gets retried on the next app start.
  if (failures === 0) await setMeta(IMAGES_BACKFILL_FLAG, "1");
  return updated;
}

/** Populate a fresh database with realistic sample data for exploring the app. */
export async function seedSampleData(): Promise<void> {
  await ensureProfile();

  const beverages = await saveCategory("Beverages");
  const snacks = await saveCategory("Snacks");

  const supplier = await saveSupplier({ name: "Acme Wholesale", contact: "orders@acme.test" });
  await saveCustomer({ name: "Walk-in", note: "Default counter sales" });
  const cafe = await saveCustomer({ name: "Corner Cafe", contact: "cafe@local.test" });

  const cola = await saveProduct({
    name: "Cola 330ml",
    barcode: "5012345678900",
    sku: "BEV-COLA-330",
    category_id: beverages,
    default_supplier_id: supplier,
    unit: "pc",
    sell_price: 1.5,
    reorder_point: 24,
    reorder_qty: 48,
  });

  const water = await saveProduct({
    name: "Spring Water 500ml",
    barcode: "5012345678917",
    sku: "BEV-WTR-500",
    category_id: beverages,
    default_supplier_id: supplier,
    unit: "pc",
    sell_price: 0.9,
    reorder_point: 30,
    reorder_qty: 60,
  });

  const chips = await saveProduct({
    name: "Salted Chips 80g",
    barcode: "5012345678924",
    sku: "SNK-CHIP-80",
    category_id: snacks,
    default_supplier_id: supplier,
    unit: "pc",
    sell_price: 2.25,
    reorder_point: 12,
    reorder_qty: 36,
  });

  // Receive stock (purchases)
  await recordMovement({ product_id: cola, type: "purchase", quantity: 48, unit_cost: 0.7, supplier_id: supplier, reference: "PO-1001" });
  await recordMovement({ product_id: water, type: "purchase", quantity: 60, unit_cost: 0.4, supplier_id: supplier, reference: "PO-1001" });
  await recordMovement({ product_id: chips, type: "purchase", quantity: 36, unit_cost: 1.1, supplier_id: supplier, reference: "PO-1002" });

  // Some sales
  await recordMovement({ product_id: cola, type: "sale", quantity: 12, unit_price: 1.5, customer_id: cafe });
  await recordMovement({ product_id: cola, type: "sale", quantity: 6, unit_price: 1.5 });
  await recordMovement({ product_id: water, type: "sale", quantity: 20, unit_price: 0.9 });
  await recordMovement({ product_id: chips, type: "sale", quantity: 28, unit_price: 2.25 });

  // A small loss
  await recordMovement({ product_id: chips, type: "loss", quantity: 2, note: "Damaged packets" });
}

export async function isDatabaseEmpty(): Promise<boolean> {
  const count = await db.products.count();
  return count === 0;
}

/**
 * Delete ALL local data — every table, including orders/invoices/payments,
 * stocktakes, counters (numbering restarts), sync bookkeeping and the profile
 * (recreated with defaults on next boot).
 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.products,
      db.movements,
      db.categories,
      db.suppliers,
      db.customers,
      db.orders,
      db.orderItems,
      db.invoices,
      db.payments,
      db.counters,
      db.stockCounts,
      db.stockCountItems,
      db.profiles,
      db.meta,
      db.outbox,
    ],
    async () => {
      await Promise.all([
        db.products.clear(),
        db.movements.clear(),
        db.categories.clear(),
        db.suppliers.clear(),
        db.customers.clear(),
        db.orders.clear(),
        db.orderItems.clear(),
        db.invoices.clear(),
        db.payments.clear(),
        db.counters.clear(),
        db.stockCounts.clear(),
        db.stockCountItems.clear(),
        db.profiles.clear(),
        db.meta.clear(),
        db.outbox.clear(),
      ]);
    }
  );
  await ensureProfile();
}
