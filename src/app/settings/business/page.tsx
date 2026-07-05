"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useProfile } from "@/lib/hooks";
import { updateProfile } from "@/lib/repo";

const CURRENCIES = ["USD", "EUR", "GBP", "PHP", "AUD", "CAD", "INR", "SGD", "JPY", "NGN", "ZAR"];

export default function BusinessSettingsPage() {
  const router = useRouter();
  const profile = useProfile();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  if (!profile) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  async function save(patch: Parameters<typeof updateProfile>[0]) {
    setSaving(true);
    try {
      await updateProfile(patch);
      toast("Saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="px-4 pt-6">
        <button onClick={() => router.push("/settings")} className="text-sm text-primary">
          ← Settings
        </button>
      </div>
      <PageHeader title="Business settings" subtitle="Company details used across the app and on invoices" />
      <div className="space-y-4 px-4 pb-8">
        <Card>
          <h2 className="mb-3 font-semibold">Business</h2>
          <div className="space-y-3">
            <Field label="Business name">
              <Input
                defaultValue={profile.display_name}
                onBlur={(e) => save({ display_name: e.target.value })}
              />
            </Field>
            <Field label="Currency">
              <Select defaultValue={profile.currency} onChange={(e) => save({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Business address" hint="Shown on the invoice header.">
              <Textarea
                rows={2}
                defaultValue={profile.business_address ?? ""}
                onBlur={(e) => save({ business_address: e.target.value || undefined })}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Invoicing</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${profile.tax_label} number`}>
              <Input
                defaultValue={profile.tax_number ?? ""}
                onBlur={(e) => save({ tax_number: e.target.value || undefined })}
              />
            </Field>
            <Field label="Payment terms (days)" hint="0 = due on issue.">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={profile.invoice_due_days}
                onBlur={(e) => save({ invoice_due_days: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Tax</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tax label">
                <Input defaultValue={profile.tax_label} onBlur={(e) => save({ tax_label: e.target.value })} />
              </Field>
              <Field label="Default rate %" hint="0–100">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={profile.default_tax_rate}
                  onBlur={(e) =>
                    save({ default_tax_rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
                  }
                />
              </Field>
            </div>
            <Field label="Prices entered as">
              <Select
                defaultValue={profile.prices_tax_inclusive ? "incl" : "excl"}
                onChange={(e) => save({ prices_tax_inclusive: e.target.value === "incl" })}
              >
                <option value="incl">Tax-inclusive</option>
                <option value="excl">Tax-exclusive</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Inventory</h2>
          <Field label="Default low-stock threshold" hint="Used when a product has no reorder point set.">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={profile.low_stock_default}
              onBlur={(e) => save({ low_stock_default: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })}
            />
          </Field>
        </Card>

        <p className="pt-2 text-center text-xs text-muted">{saving ? "Saving…" : "Changes save automatically"}</p>
      </div>
    </div>
  );
}
