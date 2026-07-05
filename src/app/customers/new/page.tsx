"use client";

import { useRouter } from "next/navigation";
import { CustomerFormSheet } from "@/components/CustomerFormSheet";

export default function NewCustomerPage() {
  const router = useRouter();
  return (
    <CustomerFormSheet
      open
      onClose={() => router.back()}
      onSaved={(id) => router.replace(`/customers/${id}`)}
    />
  );
}
