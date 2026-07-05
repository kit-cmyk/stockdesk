"use client";

// Thin wrapper around Supabase Auth. StockDesk is offline-first, so cloud
// accounts are OPTIONAL: when Supabase isn't configured (`isCloudEnabled`
// false) these helpers return a friendly "cloud not enabled" error and the
// app keeps working entirely on-device. The auth pages handle that gracefully.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isCloudEnabled } from "./supabase";

export interface AuthResult {
  error: string | null;
  /** signUp only: true when the user must confirm their email before signing in. */
  needsConfirmation?: boolean;
}

const NO_CLOUD =
  "Cloud accounts aren't set up. StockDesk runs fully on this device — continue offline.";

// ---------------------------------------------------------------------------
// Sample (demo) account — a local-only login that works while Supabase is off.
// Signing in with these credentials creates an on-device session so the auth
// flow can be exercised end-to-end without any cloud setup. When Supabase is
// configured, real accounts take over and this path is ignored.
// ---------------------------------------------------------------------------
export const DEMO_EMAIL = "kitterspimentel@gmail.com";
export const DEMO_PASSWORD = "stockdesk123";
const DEMO_SESSION_KEY = "stockdesk.demo-session";
const AUTH_EVENT = "stockdesk-auth-changed";

export function hasDemoSession(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEMO_SESSION_KEY) === DEMO_EMAIL;
}

function startDemoSession(): void {
  window.localStorage.setItem(DEMO_SESSION_KEY, DEMO_EMAIL);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

function endDemoSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEMO_SESSION_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** Map Supabase / network errors to short, human messages. */
function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "An account with this email already exists. Try signing in.";
  if (m.includes("password should be") || m.includes("at least 6"))
    return "Password must be at least 6 characters.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  if (m.includes("unable to validate email") || m.includes("invalid email"))
    return "That email address doesn't look right.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Couldn't reach the server. Check your connection and try again.";
  return msg || "Something went wrong. Please try again.";
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) {
    // Cloud off → allow the built-in sample account only.
    if (email.trim().toLowerCase() === DEMO_EMAIL) {
      if (password === DEMO_PASSWORD) {
        startDemoSession();
        return { error: null };
      }
      return { error: "Wrong email or password." };
    }
    return { error: NO_CLOUD };
  }
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? friendly(error) : null };
  } catch (err) {
    return { error: friendly(err) };
  }
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { error: NO_CLOUD };
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
      },
    });
    if (error) return { error: friendly(error) };
    // When email confirmation is required, Supabase returns a user but no session.
    const needsConfirmation = Boolean(data.user && !data.session);
    return { error: null, needsConfirmation };
  } catch (err) {
    return { error: friendly(err) };
  }
}

/** Passwordless sign-in: email a one-time magic link (SSOT screen 1). */
export async function sendMagicLink(email: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { error: NO_CLOUD };
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
      },
    });
    return { error: error ? friendly(error) : null };
  } catch (err) {
    return { error: friendly(err) };
  }
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { error: NO_CLOUD };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo:
        typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined,
    });
    return { error: error ? friendly(error) : null };
  } catch (err) {
    return { error: friendly(err) };
  }
}

export async function updatePassword(password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { error: NO_CLOUD };
  try {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error ? friendly(error) : null };
  } catch (err) {
    return { error: friendly(err) };
  }
}

export async function signOut(): Promise<void> {
  endDemoSession();
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore — offline sign-out is a no-op */
  }
}

export interface SessionState {
  session: Session | null;
  /** True when signed in via the local sample account (cloud off). */
  demo: boolean;
  /** True for either a real Supabase session or the local sample session. */
  signedIn: boolean;
  /** Email of whoever is signed in, if any. */
  email: string | null;
  loading: boolean;
  cloudEnabled: boolean;
}

/** Observe the Supabase auth session. `loading` is false immediately when cloud is off. */
export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(isCloudEnabled);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      // Cloud off → track the local sample session instead.
      setDemo(hasDemoSession());
      const onChange = () => setDemo(hasDemoSession());
      window.addEventListener(AUTH_EVENT, onChange);
      window.addEventListener("storage", onChange);
      setLoading(false);
      return () => {
        window.removeEventListener(AUTH_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    demo,
    signedIn: Boolean(session) || demo,
    email: session?.user?.email ?? (demo ? DEMO_EMAIL : null),
    loading,
    cloudEnabled: isCloudEnabled,
  };
}
