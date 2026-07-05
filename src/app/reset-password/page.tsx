"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field } from "@/components/ui";
import { AuthAlert, AuthFooterLink, AuthShell, PasswordInput } from "@/components/AuthShell";
import { updatePassword, useSession } from "@/lib/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  // The recovery link establishes a temporary session (Supabase detects the
  // token in the URL on load), so a present session means the link is valid.
  const { session, loading, cloudEnabled } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace("/");
  }

  if (!cloudEnabled) {
    return (
      <AuthShell title="Reset password" footer={<AuthFooterLink href="/login">Back to sign in</AuthFooterLink>}>
        <AuthAlert tone="info">
          Password reset needs cloud accounts, which aren&apos;t set up for this device.
        </AuthAlert>
      </AuthShell>
    );
  }

  if (loading) {
    return (
      <AuthShell title="Reset password">
        <p className="text-center text-sm text-muted">Verifying your link…</p>
      </AuthShell>
    );
  }

  if (!session) {
    return (
      <AuthShell
        title="Link expired"
        subtitle="This password reset link is invalid or has already been used."
        footer={<AuthFooterLink href="/login">Back to sign in</AuthFooterLink>}
      >
        <AuthAlert>
          Request a new link from the{" "}
          <a href="/forgot-password" className="font-semibold underline">
            forgot password
          </a>{" "}
          page.
        </AuthAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a new password for your account">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <AuthAlert>{error}</AuthAlert>}

        <Field label="New password" hint="At least 6 characters.">
          <PasswordInput
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <Field label="Confirm new password">
          <PasswordInput
            autoComplete="new-password"
            placeholder="Re-enter new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
