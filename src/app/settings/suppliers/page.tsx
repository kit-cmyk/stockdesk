"use client";

import { LookupManager } from "@/components/LookupManager";
import { useSuppliers } from "@/lib/hooks";
import { deleteSupplier, saveSupplier } from "@/lib/repo";

export default function SuppliersPage() {
  const suppliers = useSuppliers();
  return (
    <LookupManager
      title="Suppliers"
      items={suppliers}
      withContact
      onSave={({ id, name, contact }) => saveSupplier({ id, name, contact })}
      onDelete={deleteSupplier}
    />
  );
}
