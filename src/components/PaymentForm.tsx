"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "./ui";
import { useToast } from "./Toast";
import { recordPayment } from "@/lib/repo";
import type { Invoice } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

const METHODS = ["Cash", "Card", "Bank transfer", "Other"];

/** Convert a yyyy-mm-dd input into an ISO timestamp (now when it's today). */
function dateToPaidAt(date: string): string | undefined {
  if (!date) return undefined;
  const today = new Date().toLocaleDateString("en-CA");
  if (date === today) return undefined; // default = now
  return new Date(`${date}T12:00:00`).toISOString();
}

export function PaymentForm({
  invoice,
  currency,
  onDone,
}: {
  invoice: Invoice;
  currency: string;
  onDone?: () => void;
}) {
  const toast = useToast();
  const today = new Date().toLocaleDateString("en-CA");
  const balance = Math.max(0, invoice.total - invoice.amount_paid);
  const [amount, setAmount] = useState<string>(balance.toFixed(2));
  const [method, setMethod] = useState(METHODS[0]);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const value = Number(amount);
    if (!value || value <= 0) {
      toast("Enter a positive amount", "error");
      return;
    }
    if (value > balance + 0.005) {
      toast(`That's more than the ${formatMoney(balance, currency)} due`, "error");
      return;
    }
    setBusy(true);
    try {
      await recordPayment(invoice.id, {
        amount: value,
        method,
        note: note || undefined,
        paid_at: dateToPaidAt(date),
      });
      toast(`Recorded ${formatMoney(value, currency)} payment`, "success");
      onDone?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to record payment", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-surface-2 p-3 text-sm ring-1 ring-border">
        <div className="flex justify-between">
          <span className="text-muted">Balance due</span>
          <span className="font-semibold">{formatMoney(balance, currency)}</span>
        </div>
      </div>
      <Field label="Amount" hint={`At most ${formatMoney(balance, currency)}`}>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={balance}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </Field>
      <Field label="Method">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Date">
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference / detail" />
      </Field>
      <Button className="w-full" onClick={submit} disabled={busy}>
        {busy ? "Saving…" : "Record payment"}
      </Button>
    </div>
  );
}
