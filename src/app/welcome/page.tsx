"use client";

// First-run onboarding (SSOT §8 screen 1 / journey 1): capture business name,
// currency and tax settings BEFORE any prices are entered — these affect every
// movement recorded from then on and have no migration path if wrong.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useProfile } from "@/lib/hooks";
import { updateProfile } from "@/lib/repo";
import { setMeta } from "@/lib/db";

const CURRENCIES = ["USD", "EUR", "GBP", "PHP", "AUD", "CAD", "INR", "SGD", "JPY", "NGN", "ZAR"];

export default function WelcomePage() {
  const router = useRouter();
  const toast = useToast();
  const profile = useProfile();

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxLabel, setTaxLabel] = useState("VAT");
  const [taxRate, setTaxRate] = useState<string>("0");
  const [inclusive, setInclusive] = useState(true);
  const [busy, setBusy] = useState(false);

  async function finish(skip = false) {
    setBusy(true);
    try {
      if (!skip) {
        await updateProfile({
          display_name: name.trim() || profile?.display_name || "My Store",
          currency,
          tax_label: taxLabel.trim() || "Tax",
          default_tax_rate: Math.min(100, Math.max(0, Number(taxRate) || 0)),
          prices_tax_inclusive: inclusive,
        });
      }
      await setMeta("onboarded", "1");
      router.replace("/");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-10 pt-10">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-2xl">
          📦
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome to StockDesk</h1>
        <p className="mt-1 text-sm text-muted">
          A minute of setup keeps every price and profit figure correct from day one.
        </p>
      </div>

      <Card className="mt-6 space-y-4">
        <Field label="Business name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Store"
          />
        </Field>
        <Field label="Currency" hint="All prices and reports use this currency.">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax name">
            <Input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} placeholder="VAT / GST" />
          </Field>
          <Field label="Default rate %">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Prices entered as"
          hint="Whether the prices you type already include tax. This affects profit math — pick carefully."
        >
          <Select
            value={inclusive ? "incl" : "excl"}
            onChange={(e) => setInclusive(e.target.value === "incl")}
          >
            <option value="incl">Tax-inclusive</option>
            <option value="excl">Tax-exclusive</option>
          </Select>
        </Field>
        <Button className="w-full" onClick={() => finish(false)} disabled={busy}>
          {busy ? "Saving…" : "Start using StockDesk"}
        </Button>
      </Card>

      <button
        onClick={() => finish(true)}
        disabled={busy}
        className="mt-4 w-full text-center text-sm text-muted"
      >
        Skip for now — use defaults (USD, {taxLabel || "VAT"} 0%)
      </button>
    </div>
  );
}
