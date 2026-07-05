"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, PageHeader } from "./ui";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export interface LookupItem {
  id: string;
  name: string;
  contact?: string;
  note?: string;
}

export function LookupManager({
  title,
  items,
  withContact,
  withNote,
  onSave,
  onDelete,
}: {
  title: string;
  items: LookupItem[] | undefined;
  withContact?: boolean;
  withNote?: boolean;
  onSave: (data: { id?: string; name: string; contact?: string; note?: string }) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LookupItem | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const singular = title.toLowerCase().slice(0, -1);

  function openNew() {
    setEditing(null);
    setName("");
    setContact("");
    setNote("");
    setOpen(true);
  }

  function openEdit(item: LookupItem) {
    setEditing(item);
    setName(item.name);
    setContact(item.contact ?? "");
    setNote(item.note ?? "");
    setOpen(true);
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({
        id: editing?.id,
        name: name.trim(),
        contact: withContact ? contact.trim() || undefined : undefined,
        note: withNote ? note.trim() || undefined : undefined,
      });
      setOpen(false);
      toast(editing ? "Saved" : "Added", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || !onDelete) return;
    if (!window.confirm(`Delete "${editing.name}"? Products using it fall back to none.`)) return;
    setBusy(true);
    try {
      await onDelete(editing.id);
      setOpen(false);
      toast("Deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center px-4 pt-6">
        <button onClick={() => router.back()} className="text-sm text-primary">
          ← Back
        </button>
      </div>
      <PageHeader
        title={title}
        action={<Button className="h-10 px-3" onClick={openNew}>+ Add</Button>}
      />
      <div className="space-y-4 px-4 pb-8">
        {items && items.length > 0 ? (
          <Card>
            <ul className="divide-y divide-border">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => openEdit(it)}
                    className="flex w-full items-center justify-between py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{it.name}</span>
                      {(it.contact || it.note) && (
                        <span className="block truncate text-xs text-muted">{it.contact || it.note}</span>
                      )}
                    </span>
                    <span className="ml-2 shrink-0 text-xs text-muted">Edit</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            title={`No ${title.toLowerCase()} yet`}
            body={`Add your first ${singular}.`}
            action={<Button onClick={openNew}>{`Add ${singular}`}</Button>}
          />
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${singular}` : `New ${singular}`}>
        <div className="space-y-4">
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`New ${singular}`}
            />
          </Field>
          {withContact && (
            <Field label="Contact">
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone / email (optional)" />
            </Field>
          )}
          {withNote && (
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
          )}
          <Button className="w-full" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : editing ? "Save changes" : `Add ${singular}`}
          </Button>
          {editing && onDelete && (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-danger"
              onClick={remove}
              disabled={busy}
            >
              Delete {singular}
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
