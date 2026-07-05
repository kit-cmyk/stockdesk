"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { AuthAlert, AuthFooterLink, AuthShell } from "@/components/AuthShell";
import { sendPasswordReset, useSession } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const { cloudEnabled } = useSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await sendPasswordReset(email.trim());
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`If an account exists for ${email.trim()}, a reset link is on its way.`}
        footer={<AuthFooterLink href="/login">Back to sign in</AuthFooterLink>}
      >
        <AuthAlert tone="success">
          Open the link in your inbox to choose a new password. It may take a minute to arrive — check
          spam if you don&apos;t see it.
        </AuthAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link"
      footer={<AuthFooterLink href="/login">Back to sign in</AuthFooterLink>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!cloudEnabled && (
          <AuthAlert tone="info">
            Password reset needs cloud accounts, which aren&apos;t set up yet.{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Back to sign in
            </Link>
          </AuthAlert>
        )}
        {error && <AuthAlert>{error}</AuthAlert>}

        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" className="w-full" disabled={busy || !cloudEnabled}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
