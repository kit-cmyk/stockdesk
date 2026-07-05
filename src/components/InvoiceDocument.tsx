"use client";

import type { Customer, Invoice, OrderItem, Payment, Product, Profile } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

/** A clean, print-friendly invoice document. Wrapped in #invoice-print so the
 *  print stylesheet (globals.css) can isolate it from the app chrome. */
export function InvoiceDocument({
  invoice,
  items,
  productName,
  customer,
  profile,
  payments,
}: {
  invoice: Invoice;
  items: OrderItem[];
  productName: (id: string) => string;
  customer?: Customer;
  profile: Profile;
  payments: Payment[];
}) {
  const currency = profile.currency;
  const balance = Math.max(0, invoice.total - invoice.amount_paid);

  return (
    <div id="invoice-print" className="rounded-2xl bg-surface p-5 ring-1 ring-border sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text">{profile.display_name}</h1>
          {profile.business_address && (
            <p className="mt-1 whitespace-pre-line text-xs text-muted">{profile.business_address}</p>
          )}
          {profile.tax_number && (
            <p className="mt-1 text-xs text-muted">
              {profile.tax_label} no. {profile.tax_number}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tracking-tight">INVOICE</div>
          <div className="text-sm font-medium text-muted">{invoice.invoice_no}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-between gap-4 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Bill to</div>
          <div className="mt-1 font-medium">{customer?.name ?? "Walk-in customer"}</div>
          {customer?.contact && <div className="text-xs text-muted">{customer.contact}</div>}
        </div>
        <div className="text-right text-sm">
          <Line k="Issued" v={formatDate(invoice.issued_at)} />
          {invoice.due_at && <Line k="Due" v={formatDate(invoice.due_at)} />}
          <Line k="Status" v={invoice.status.toUpperCase()} />
        </div>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 font-medium">Item</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Price</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-border/60">
              <td className="py-2 pr-2">{productName(it.product_id)}</td>
              <td className="py-2 text-right tabular-nums">{it.quantity}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(it.unit_price, currency)}</td>
              <td className="py-2 text-right tabular-nums">
                {formatMoney(it.quantity * it.unit_price, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
        <Line k="Subtotal" v={formatMoney(invoice.subtotal, currency)} />
        {invoice.tax_total > 0 && (
          <Line k={profile.tax_label} v={formatMoney(invoice.tax_total, currency)} />
        )}
        <div className="flex justify-between border-t border-border pt-1 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(invoice.total, currency)}</span>
        </div>
        {invoice.amount_paid > 0 && (
          <Line k="Paid" v={`− ${formatMoney(invoice.amount_paid, currency)}`} />
        )}
        <div className="flex justify-between text-base font-bold">
          <span>Balance due</span>
          <span className="tabular-nums">{formatMoney(balance, currency)}</span>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Payments</div>
          <ul className="mt-1 divide-y divide-border/60 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span className="text-muted">
                  {formatDate(p.paid_at)}
                  {p.method ? ` · ${p.method}` : ""}
                </span>
                <span className="tabular-nums">{formatMoney(p.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invoice.status === "void" && (
        <div className="mt-6 text-center text-sm font-semibold text-danger">VOID</div>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-muted">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
