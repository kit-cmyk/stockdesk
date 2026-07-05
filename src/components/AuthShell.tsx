"use client";

import { forwardRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { InstallApp } from "./InstallApp";

/** Centered, chrome-free shell for the auth pages (no app nav). */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-sm">
            <ScanIcon />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-text">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        </div>

        <div className="rounded-2xl bg-surface p-6 ring-1 ring-border">{children}</div>

        <div className="mt-4">
          <InstallApp />
        </div>

        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

/** Inline status banner used for form-level errors / success notices. */
export function AuthAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const tones = {
    error: "bg-danger/10 text-danger ring-danger/20",
    success: "bg-success/10 text-success ring-success/25",
    info: "bg-surface-2 text-muted ring-border",
  };
  return (
    <div className={cn("rounded-xl px-3.5 py-3 text-sm font-medium ring-1", tones[tone])} role="alert">
      {children}
    </div>
  );
}

/** Password field with a show/hide toggle. Shares the app Input styling. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function PasswordInput({ className, ...props }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={show ? "text" : "password"}
        className={cn(
          "h-12 w-full rounded-xl bg-surface-2 px-3.5 pr-11 text-base text-text ring-1 ring-border outline-none placeholder:text-muted focus:ring-2 focus:ring-primary",
          className
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted transition hover:text-text"
        tabIndex={-1}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
});

export function AuthFooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-primary hover:underline">
      {children}
    </Link>
  );
}

function ScanIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M4 12h16" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.36M6.6 6.6A13.2 13.2 0 0 0 2 11s3.5 7 10 7a9.1 9.1 0 0 0 3.4-.66" />
      <path d="M3 3l18 18" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
