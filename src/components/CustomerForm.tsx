"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "./ui";
import { useToast } from "./Toast";
import { saveCustomer } from "@/lib/repo";
import type { Customer } from "@/lib/types";

export function CustomerForm({
  customer,
  onSaved,
}: {
  customer?: Customer;
  /** Called with the saved customer id. Defaults to navigating to its detail page. */
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? "");
  const [contact, setContact] = useState(customer?.contact ?? "");
  const [note, setNote] = useState(customer?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setBusy(true);
    try {
      const id = await saveCustomer({
        id: customer?.id,
        name: name.trim(),
        contact: contact.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast(customer ? "Saved" : "Customer added", "success");
      if (onSaved) onSaved(id);
      else router.replace(`/customers/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
      </Field>
      <Field label="Contact">
        <Input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Phone / email (optional)"
        />
      </Field>
      <Field label="Note">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" rows={3} />
      </Field>
      <Button className="w-full" onClick={save} disabled={busy || !name.trim()}>
        {busy ? "Saving…" : customer ? "Save changes" : "Add customer"}
      </Button>
    </div>
  );
}
