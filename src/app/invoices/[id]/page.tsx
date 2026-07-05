"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, DetailSkeleton, LinkButton } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { PaymentForm } from "@/components/PaymentForm";
import { useToast } from "@/components/Toast";
import {
  useCustomer,
  useInvoice,
  useOrderItems,
  usePayments,
  useProducts,
  useProfile,
} from "@/lib/hooks";
import { voidInvoice } from "@/lib/repo";
import { formatDate, formatMoney } from "@/lib/utils";

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const profile = useProfile();
  const invoice = useInvoice(params.id);
  const items = useOrderItems(invoice?.order_id);
  const products = useProducts({ includeArchived: true });
  const customer = useCustomer(invoice?.customer_id) ?? undefined;
  const payments = usePayments(params.id);
  const [paying, setPaying] = useState(false);

  const productName = useMemo(() => {
    const m = new Map<string, string>();
    products?.forEach((p) => m.set(p.id, p.name));
    return (id: string) => m.get(id) ?? "Unknown product";
  }, [products]);

  if (!profile || invoice === undefined || !items || !products || !payments) {
    return <DetailSkeleton />;
  }
  if (invoice === null) {
    return (
      <div className="px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Invoice not found</h1>
        <p className="mt-1 text-sm text-muted">It may have been deleted or the link is stale.</p>
        <Button className="mt-4" onClick={() => router.push("/invoices")}>
          Go to invoices
        </Button>
      </div>
    );
  }

  const balance = Math.max(0, invoice.total - invoice.amount_paid);
  const settled = invoice.status === "paid" || invoice.status === "void";

  function exportCsv() {
    const rows: string[][] = [
      ["Invoice", invoice!.invoice_no],
      ["Customer", customer?.name ?? "Walk-in"],
      ["Issued", formatDate(invoice!.issued_at)],
      [],
      ["Item", "Qty", "Unit price", "Amount"],
      ...items!.map((it) => [
        productName(it.product_id),
        String(it.quantity),
        it.unit_price.toFixed(2),
        (it.quantity * it.unit_price).toFixed(2),
      ]),
      [],
      ["Subtotal", invoice!.subtotal.toFixed(2)],
      [profile!.tax_label, invoice!.tax_total.toFixed(2)],
      ["Total", invoice!.total.toFixed(2)],
      ["Paid", invoice!.amount_paid.toFixed(2)],
      ["Balance", balance.toFixed(2)],
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice!.invoice_no}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doVoid() {
    if (!confirm("Void this invoice? This does not return stock.")) return;
    try {
      await voidInvoice(invoice!.id);
      toast("Invoice voided", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to void", "error");
    }
  }

  return (
    <div className="px-4 pb-8">
      <div className="no-print flex items-center justify-between pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
        <div className="flex gap-2">
          <Button variant="ghost" className="h-9 px-3" onClick={exportCsv}>
            CSV
          </Button>
          <Button variant="ghost" className="h-9 px-3" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <InvoiceDocument
          invoice={invoice}
          items={items}
          productName={productName}
          customer={customer}
          profile={profile}
          payments={payments}
        />
      </div>

      <div className="no-print mt-4 space-y-3">
        {!settled && balance > 0 && (
          <Button className="w-full" onClick={() => setPaying(true)}>
            Record payment · {formatMoney(balance, profile.currency)} due
          </Button>
        )}
        <LinkButton href={`/orders/${invoice.order_id}`} variant="secondary" className="w-full">
          View order
        </LinkButton>
        {invoice.status !== "void" && invoice.amount_paid === 0 && (
          <button onClick={doVoid} className="w-full text-center text-sm text-muted">
            Void invoice
          </button>
        )}
        {invoice.status !== "void" && invoice.amount_paid > 0 && (
          <p className="text-center text-xs text-muted">
            This invoice has recorded payments, so it can no longer be voided.
          </p>
        )}
      </div>

      <Sheet open={paying} onClose={() => setPaying(false)} title="Record payment">
        <PaymentForm invoice={invoice} currency={profile.currency} onDone={() => setPaying(false)} />
      </Sheet>
    </div>
  );
}
