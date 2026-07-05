"use client";

import { CustomerForm } from "./CustomerForm";
import { Sheet } from "./Sheet";
import type { Customer } from "@/lib/types";

/** Customer create/edit form presented in a side sheet. */
export function CustomerFormSheet({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer?: Customer;
  onSaved?: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={customer ? "Edit customer" : "New customer"}>
      <CustomerForm customer={customer} onSaved={onSaved} />
    </Sheet>
  );
}
