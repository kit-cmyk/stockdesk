"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, Select, Stepper } from "./ui";
import { Sheet } from "./Sheet";
import { Scanner } from "./Scanner";
import { useToast } from "./Toast";
import {
  addOrderItem,
  computeOrderTotals,
  confirmOrder,
  deleteDraftOrder,
  findByCode,
  removeOrderItem,
  setOrderCustomer,
  setOrderDate,
  setOrderNote,
  updateOrderItem,
} from "@/lib/repo";
import type { Customer, Order, OrderItem, Product, Profile } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export function OrderCart({
  order,
  items,
  products,
  customers,
  profile,
}: {
  order: Order;
  items: OrderItem[];
  products: Product[];
  customers: Customer[];
  profile: Profile;
}) {
  const router = useRouter();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const totals = useMemo(() => computeOrderTotals(items, profile), [items, profile]);

  async function pick(productId: string) {
    try {
      await addOrderItem(order.id, { product_id: productId });
      setPicking(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to add", "error");
    }
  }

  async function confirm() {
    if (items.length === 0) {
      toast("Add at least one item first", "error");
      return;
    }
    // SSOT §6: overselling is allowed but must be warned about.
    const oversold = items
      .map((it) => ({ it, product: productById.get(it.product_id) }))
      .filter(({ it, product }) => product && it.quantity > product.quantity_on_hand);
    if (oversold.length > 0) {
      const lines = oversold
        .map(({ it, product }) => `${product!.name}: ${product!.quantity_on_hand} on hand, selling ${it.quantity}`)
        .join("\n");
      if (!window.confirm(`This order takes stock negative:\n${lines}\nConfirm anyway?`)) return;
    }
    setBusy(true);
    try {
      const { invoice } = await confirmOrder(order.id);
      toast(`Order ${order.order_no} confirmed`, "success");
      router.replace(`/invoices/${invoice.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to confirm", "error");
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await deleteDraftOrder(order.id);
      toast("Draft discarded", "success");
      router.replace("/orders");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to discard", "error");
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-8">
      <div className="flex items-center justify-between pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
        <span className="text-sm font-medium text-muted">{order.order_no} · Draft</span>
      </div>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">New order</h1>

      <Card className="mt-4 space-y-3">
        <Field label="Customer">
          <Select
            value={order.customer_id ?? ""}
            onChange={(e) =>
              setOrderCustomer(order.id, e.target.value || undefined).catch((err) =>
                toast(err instanceof Error ? err.message : "Failed to update", "error")
              )
            }
          >
            <option value="">— Walk-in —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input
              type="date"
              value={order.occurred_at.slice(0, 10)}
              max={new Date().toLocaleDateString("en-CA")}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setOrderDate(order.id, new Date(`${v}T12:00:00`).toISOString()).catch((err) =>
                  toast(err instanceof Error ? err.message : "Failed to update", "error")
                );
              }}
            />
          </Field>
          <Field label="Note (optional)">
            <Input
              defaultValue={order.note ?? ""}
              placeholder="Internal note"
              onBlur={(e) =>
                setOrderNote(order.id, e.target.value || undefined).catch((err) =>
                  toast(err instanceof Error ? err.message : "Failed to update", "error")
                )
              }
            />
          </Field>
        </div>
      </Card>

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <EmptyState title="No items yet" body="Add products to build this order." />
        ) : (
          items.map((it) => {
            const product = productById.get(it.product_id);
            return (
              <Card key={it.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{product?.name ?? "Unknown product"}</div>
                    <div className="text-xs text-muted">
                      {formatMoney(it.quantity * it.unit_price, profile.currency)}
                    </div>
                  </div>
                  <button
                    onClick={() => removeOrderItem(it.id).catch((e) => toast(e instanceof Error ? e.message : "Failed to remove", "error"))}
                    className="shrink-0 text-sm text-danger"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Qty">
                    <Stepper
                      value={it.quantity}
                      onChange={(q) =>
                        updateOrderItem(it.id, { quantity: q }).catch((e) =>
                          toast(e instanceof Error ? e.message : "Failed to update", "error")
                        )
                      }
                    />
                  </Field>
                  <Field label={`Unit price (${profile.prices_tax_inclusive ? "incl." : "excl."} ${profile.tax_label})`}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={it.unit_price}
                      onChange={(e) =>
                        updateOrderItem(it.id, {
                          unit_price: Math.max(0, Number(e.target.value) || 0),
                        }).catch((err) =>
                          toast(err instanceof Error ? err.message : "Failed to update", "error")
                        )
                      }
                    />
                  </Field>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Button variant="secondary" className="mt-3 w-full" onClick={() => setPicking(true)}>
        + Add product
      </Button>

      <Card className="mt-4">
        <Row label="Subtotal" value={formatMoney(totals.subtotal, profile.currency)} />
        {totals.tax_total > 0 && (
          <Row label={profile.tax_label} value={formatMoney(totals.tax_total, profile.currency)} />
        )}
        <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(totals.total, profile.currency)}</span>
        </div>
      </Card>

      <Button className="mt-4 w-full" onClick={confirm} disabled={busy || items.length === 0}>
        {busy ? "Working…" : "Confirm order & invoice"}
      </Button>
      <button onClick={discard} disabled={busy} className="mt-4 w-full text-center text-sm text-muted">
        Discard draft
      </button>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Add product">
        <ProductPicker products={products} profile={profile} onPick={pick} onError={(m) => toast(m, "error")} />
      </Sheet>
    </div>
  );
}

function ProductPicker({
  products,
  profile,
  onPick,
  onError,
}: {
  products: Product[];
  profile: Profile;
  onPick: (productId: string) => void;
  onError: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [scanning, setScanning] = useState(false);

  const list = useMemo(() => {
    const active = products.filter((p) => !p.is_archived);
    const needle = q.trim().toLowerCase();
    if (!needle) return active.slice(0, 50);
    return active
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.sku?.toLowerCase().includes(needle) ||
          p.barcode?.includes(needle)
      )
      .slice(0, 50);
  }, [products, q]);

  async function onScan(code: string) {
    const product = await findByCode(code);
    if (!product) {
      onError(`No product for "${code}"`);
      return;
    }
    if (product.is_archived) {
      onError(`"${product.name}" is archived — restore it before selling`);
      return;
    }
    onPick(product.id);
    setScanning(false);
  }

  if (scanning) {
    return (
      <div className="space-y-3">
        <Scanner onResult={onScan} />
        <Button variant="secondary" className="w-full" onClick={() => setScanning(false)}>
          Cancel scan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" />
        <Button variant="secondary" className="shrink-0" onClick={() => setScanning(true)}>
          Scan
        </Button>
      </div>
      <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
        {list.length === 0 ? (
          <li className="py-6 text-center text-sm text-muted">No products found.</li>
        ) : (
          list.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onPick(p.id)}
                className="flex w-full items-center justify-between py-2.5 text-left"
              >
                <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted">
                  {p.sell_price != null ? formatMoney(p.sell_price, profile.currency) : "—"} ·{" "}
                  {p.quantity_on_hand} {p.unit}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
