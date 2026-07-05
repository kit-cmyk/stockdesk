"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { AuthAlert, AuthFooterLink, AuthShell, PasswordInput } from "@/components/AuthShell";
import { DEMO_EMAIL, DEMO_PASSWORD, sendMagicLink, signInWithPassword, useSession } from "@/lib/auth";
import { isDatabaseEmpty, seedPricelistData } from "@/lib/seed";

export default function LoginPage() {
  const router = useRouter();
  const { signedIn, cloudEnabled } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in → go to the dashboard.
  useEffect(() => {
    if (signedIn) router.replace("/");
  }, [signedIn, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await signInWithPassword(email.trim(), password);
    if (error) {
      setBusy(false);
      setError(error);
      return;
    }
    // First sign-in on a fresh device → preload the product catalog.
    try {
      if (await isDatabaseEmpty()) await seedPricelistData();
    } finally {
      setBusy(false);
    }
    router.replace("/");
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your StockDesk account"
      footer={
        <>
          New here? <AuthFooterLink href="/signup">Create an account</AuthFooterLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!cloudEnabled && (
          <AuthAlert tone="info">
            Cloud accounts aren&apos;t set up yet — sign in with the sample login:{" "}
            <span className="font-mono font-semibold">{DEMO_EMAIL}</span> /{" "}
            <span className="font-mono font-semibold">{DEMO_PASSWORD}</span>. Everything stays on
            this device.
          </AuthAlert>
        )}
        {error && <AuthAlert>{error}</AuthAlert>}
        {info && <AuthAlert tone="info">{info}</AuthAlert>}

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

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Password</span>
            <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
              Forgot?
            </Link>
          </div>
          <PasswordInput
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        {cloudEnabled && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={async () => {
              setError(null);
              setInfo(null);
              if (!email.trim()) {
                setError("Enter your email above first, then request a link.");
                return;
              }
              setBusy(true);
              const { error } = await sendMagicLink(email.trim());
              setBusy(false);
              if (error) setError(error);
              else setInfo("Check your email — we sent you a one-tap sign-in link.");
            }}
          >
            Email me a sign-in link
          </Button>
        )}
      </form>
    </AuthShell>
  );
}
