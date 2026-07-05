"use client";

import { useParams, useRouter } from "next/navigation";
import { DetailSkeleton } from "@/components/ui";
import { CustomerFormSheet } from "@/components/CustomerFormSheet";
import { useCustomer } from "@/lib/hooks";

export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const customer = useCustomer(params.id);

  if (customer === undefined) return <DetailSkeleton />;
  if (!customer) return <div className="px-4 pt-10 text-center text-muted">Customer not found.</div>;

  return (
    <CustomerFormSheet
      open
      onClose={() => router.back()}
      customer={customer}
      onSaved={(id) => router.replace(`/customers/${id}`)}
    />
  );
}
