"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { AuthAlert, AuthFooterLink, AuthShell, PasswordInput } from "@/components/AuthShell";
import { signUpWithPassword, useSession } from "@/lib/auth";

export default function SignupPage() {
  const router = useRouter();
  const { session, cloudEnabled } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

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
    const { error, needsConfirmation } = await signUpWithPassword(email.trim(), password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    if (needsConfirmation) {
      setDone(true); // show "check your email" state
      return;
    }
    router.replace("/");
  }

  if (done) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email.trim()}`}
        footer={<AuthFooterLink href="/login">Back to sign in</AuthFooterLink>}
      >
        <AuthAlert tone="success">
          Open the link in your inbox to activate your account, then sign in.
        </AuthAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start tracking your inventory in minutes"
      footer={
        <>
          Already have an account? <AuthFooterLink href="/login">Sign in</AuthFooterLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!cloudEnabled && (
          <AuthAlert tone="info">
            Cloud accounts aren&apos;t set up yet — StockDesk runs fully on this device.{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Use the sample login instead
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

        <Field label="Password" hint="At least 6 characters.">
          <PasswordInput
            autoComplete="new-password"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <Field label="Confirm password">
          <PasswordInput
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" className="w-full" disabled={busy || !cloudEnabled}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
