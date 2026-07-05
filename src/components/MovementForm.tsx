"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Select, Stepper } from "./ui";
import { useToast } from "./Toast";
import { recordMovement } from "@/lib/repo";
import { effectiveTaxRate, taxFromLineTotal } from "@/lib/inventory";
import type { MovementType, Product, Profile } from "@/lib/types";
import { useCustomers, useSuppliers } from "@/lib/hooks";
import { formatMoney } from "@/lib/utils";

type Mode = "receive" | "sell" | "adjust";

// Adjust-mode reasons map to their proper ledger types (SSOT §4/§6): losses and
// returns must be distinguishable from plain count corrections.
type AdjustReason = "correction" | "count" | "loss" | "return_out" | "return_in";

const ADJUST_REASONS: Array<{ value: AdjustReason; label: string; type: MovementType; direction: "add" | "remove" | "either" }> = [
  { value: "correction", label: "Correction", type: "adjustment", direction: "either" },
  { value: "count", label: "Stock count", type: "adjustment", direction: "either" },
  { value: "loss", label: "Damaged / loss", type: "loss", direction: "remove" },
  { value: "return_out", label: "Return to supplier", type: "return_out", direction: "remove" },
  { value: "return_in", label: "Customer return", type: "return_in", direction: "add" },
];

/** Convert a yyyy-mm-dd input into an ISO business date (now when it's today). */
function dateToOccurredAt(date: string): string | undefined {
  if (!date) return undefined;
  const today = new Date().toLocaleDateString("en-CA");
  if (date === today) return undefined; // default = now
  return new Date(`${date}T12:00:00`).toISOString();
}

export function MovementForm({
  mode,
  product,
  profile,
  onDone,
}: {
  mode: Mode;
  product: Product;
  profile: Profile;
  onDone?: () => void;
}) {
  const toast = useToast();
  const suppliers = useSuppliers();
  const customers = useCustomers();

  const today = new Date().toLocaleDateString("en-CA");
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState(product.avg_cost || "");
  const [unitPrice, setUnitPrice] = useState(product.sell_price ?? "");
  const [supplierId, setSupplierId] = useState(product.default_supplier_id ?? "");
  const [customerId, setCustomerId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [reason, setReason] = useState<AdjustReason>("correction");
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);

  const rate = effectiveTaxRate(product, profile);
  const reasonSpec = ADJUST_REASONS.find((r) => r.value === reason)!;
  const effectiveDirection = reasonSpec.direction === "either" ? direction : reasonSpec.direction === "add" ? "add" : "remove";

  const preview = useMemo(() => {
    if (mode === "sell") {
      const price = Number(unitPrice) || 0;
      const lineTotal = qty * price;
      const tax = taxFromLineTotal(lineTotal, rate, profile.prices_tax_inclusive);
      // Inclusive: tax is carved out of the price. Exclusive: the entered price
      // already is net — tax sits on top and must not be deducted.
      const net = profile.prices_tax_inclusive ? lineTotal - tax : lineTotal;
      const gross = profile.prices_tax_inclusive ? lineTotal : lineTotal + tax;
      const cogs = qty * product.avg_cost;
      return { lineTotal, gross, tax, net, profit: net - cogs };
    }
    if (mode === "receive") {
      const cost = Number(unitCost) || 0;
      const lineTotal = qty * cost;
      const tax = taxFromLineTotal(lineTotal, rate, false);
      return { lineTotal, gross: lineTotal + tax, tax, net: lineTotal, profit: 0 };
    }
    return null;
  }, [mode, qty, unitPrice, unitCost, rate, profile.prices_tax_inclusive, product.avg_cost]);

  /** SSOT §6: negative stock is allowed, but must be warned about. */
  function confirmOversell(outQty: number): boolean {
    const after = product.quantity_on_hand - outQty;
    if (after >= 0) return true;
    return window.confirm(
      `Only ${product.quantity_on_hand} ${product.unit} on hand — this will take stock to ${after}. Record anyway?`
    );
  }

  async function submit() {
    setSaving(true);
    try {
      const occurred_at = dateToOccurredAt(date);
      if (mode === "receive") {
        await recordMovement({
          product_id: product.id,
          type: "purchase",
          quantity: qty,
          unit_cost: Number(unitCost) || 0,
          supplier_id: supplierId || undefined,
          reference: reference || undefined,
          note: note || undefined,
          occurred_at,
        });
        toast(`Received ${qty} × ${product.name}`, "success");
      } else if (mode === "sell") {
        if (!confirmOversell(qty)) return;
        await recordMovement({
          product_id: product.id,
          type: "sale",
          quantity: qty,
          unit_price: Number(unitPrice) || 0,
          customer_id: customerId || undefined,
          reference: reference || undefined,
          note: note || undefined,
          occurred_at,
        });
        const profit = preview ? formatMoney(preview.profit, profile.currency) : "";
        toast(`Sold ${qty} × ${product.name} · ${profit} profit`, "success");
      } else {
        const removing = effectiveDirection === "remove";
        if (removing && !confirmOversell(qty)) return;
        const type = reasonSpec.type;
        if (type === "adjustment") {
          const signed = removing ? -qty : qty;
          await recordMovement({
            product_id: product.id,
            type: "adjustment",
            quantity: signed,
            unit_cost: !removing ? Number(unitCost) || undefined : undefined,
            note: note || reasonSpec.label,
            occurred_at,
          });
          toast(`Adjusted ${product.name} by ${signed > 0 ? "+" : ""}${signed}`, "success");
        } else {
          // loss / return_out / return_in post as their own ledger types so
          // shrinkage and returns stay distinguishable in reports.
          await recordMovement({
            product_id: product.id,
            type,
            quantity: qty,
            unit_cost: type === "return_in" ? Number(unitCost) || undefined : undefined,
            supplier_id: type === "return_out" ? supplierId || undefined : undefined,
            customer_id: type === "return_in" ? customerId || undefined : undefined,
            note: note || reasonSpec.label,
            occurred_at,
          });
          toast(`Recorded ${reasonSpec.label.toLowerCase()} · ${qty} × ${product.name}`, "success");
        }
      }
      onDone?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {mode === "adjust" && (
        <>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
              {ADJUST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          {reasonSpec.direction === "either" && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={direction === "add" ? "primary" : "secondary"}
                onClick={() => setDirection("add")}
              >
                Add stock
              </Button>
              <Button
                type="button"
                variant={direction === "remove" ? "primary" : "secondary"}
                onClick={() => setDirection("remove")}
              >
                Remove stock
              </Button>
            </div>
          )}
        </>
      )}

      <Field label="Quantity">
        <Stepper value={qty} onChange={setQty} />
      </Field>

      {mode === "receive" && (
        <>
          <Field label={`Unit cost (ex-${profile.tax_label})`}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Supplier (optional)">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— None —</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference (optional)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / invoice no." />
          </Field>
        </>
      )}

      {mode === "sell" && (
        <>
          <Field label={`Unit price (${profile.prices_tax_inclusive ? "incl." : "excl."} ${profile.tax_label})`}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Customer (optional)">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Walk-in —</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference (optional)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt / order no." />
          </Field>
        </>
      )}

      {mode === "adjust" && effectiveDirection === "add" && (
        <Field label={`Unit cost (optional, ex-${profile.tax_label})`} hint="Set a cost to update average cost for added stock.">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="0.00"
          />
        </Field>
      )}

      {mode === "adjust" && reason === "return_out" && (
        <Field label="Supplier (optional)">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— None —</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {mode === "adjust" && reason === "return_in" && (
        <Field label="Customer (optional)">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Walk-in —</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Date" hint="Backdate to record past activity on the right business day.">
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / detail" />
      </Field>

      {preview && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm ring-1 ring-border">
          <Row label="Line total" value={formatMoney(preview.lineTotal, profile.currency)} />
          {rate > 0 && (
            <Row label={`${profile.tax_label} (${rate}%)`} value={formatMoney(preview.tax, profile.currency)} />
          )}
          {rate > 0 && !profile.prices_tax_inclusive && (
            <Row label={`Total incl. ${profile.tax_label}`} value={formatMoney(preview.gross, profile.currency)} />
          )}
          {mode === "sell" && (
            <>
              <Row label="Net revenue" value={formatMoney(preview.net, profile.currency)} />
              <Row
                label="Profit"
                value={formatMoney(preview.profit, profile.currency)}
                tone={preview.profit >= 0 ? "success" : "danger"}
              />
            </>
          )}
        </div>
      )}

      <Button className="w-full" onClick={submit} disabled={saving}>
        {saving ? "Saving…" : mode === "receive" ? "Receive stock" : mode === "sell" ? "Record sale" : "Apply adjustment"}
      </Button>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted">{label}</span>
      <span
        className={
          tone === "success" ? "font-semibold text-success" : tone === "danger" ? "font-semibold text-danger" : "font-medium text-text"
        }
      >
        {value}
      </span>
    </div>
  );
}
