"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { forwardRef } from "react";

// ---------- Button ----------
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:brightness-110 active:brightness-95",
  secondary: "bg-surface-2 text-text ring-1 ring-border hover:bg-border",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-danger text-primary-fg hover:brightness-110",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ className, variant = "primary", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        buttonStyles[variant],
        className
      )}
      {...props}
    />
  );
});

export function LinkButton({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition",
        buttonStyles[variant],
        className
      )}
    >
      {children}
    </Link>
  );
}

// ---------- Card ----------
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl bg-surface p-4 ring-1 ring-border", className)}>{children}</div>
  );
}

// ---------- Field + inputs ----------
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-xl bg-surface-2 px-3.5 text-base text-text ring-1 ring-border outline-none placeholder:text-muted focus:ring-2 focus:ring-primary",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-xl bg-surface-2 p-3.5 text-base text-text ring-1 ring-border outline-none placeholder:text-muted focus:ring-2 focus:ring-primary",
        className
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-12 w-full rounded-xl bg-surface-2 px-3 text-base text-text ring-1 ring-border outline-none focus:ring-2 focus:ring-primary",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});

// ---------- Filter bar (search + filters, always right-aligned) ----------
// Shared base so the compact toolbar controls match the form Input/Select.
const controlBase =
  "h-11 rounded-xl bg-surface-2 text-text ring-1 ring-border outline-none focus:ring-2 focus:ring-primary";

/** Toolbar row that keeps search & filter controls aligned to the right. */
export function FilterBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 px-4", className)}>
      {children}
    </div>
  );
}

/** Search field with a leading icon; grows to fill, sits left of the filters. */
export const SearchInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className, ...props }, ref) {
    return (
      <div className={cn("relative min-w-[7rem] flex-1", className)}>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={ref}
          className={cn(controlBase, "w-full pl-9 pr-3 text-base placeholder:text-muted")}
          {...props}
        />
      </div>
    );
  }
);

/** Compact, content-width select for filters/sorting in a FilterBar. */
export const FilterSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function FilterSelect({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(controlBase, "max-w-[10rem] px-3 text-sm font-medium", className)}
      {...props}
    >
      {children}
    </select>
  );
});

// ---------- Quantity stepper ----------
export function Stepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <Button
        type="button"
        variant="secondary"
        className="h-14 w-16 text-2xl"
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </Button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.trunc(Number(e.target.value) || min)))}
        className="h-14 flex-1 rounded-xl bg-surface-2 text-center text-3xl font-bold text-text ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <Button
        type="button"
        variant="secondary"
        className="h-14 w-16 text-2xl"
        onClick={() => onChange(value + 1)}
      >
        +
      </Button>
    </div>
  );
}

// ---------- Badge ----------
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted ring-border",
    success: "bg-success/15 text-success ring-success/30",
    warning: "bg-warning/15 text-warning ring-warning/30",
    danger: "bg-danger/15 text-danger ring-danger/30",
    primary: "bg-primary/15 text-primary ring-primary/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

// ---------- Stat ----------
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "text-text";
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

// ---------- Skeletons (loading placeholders — never full-screen spinners) ----------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

/** List-shaped loading placeholder for cached list screens. */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 px-4", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Detail-page loading placeholder (title + stat grid + list). */
export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4 px-4 pt-6", className)} aria-hidden>
      <Skeleton className="h-7 w-1/2" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}

// ---------- Empty state ----------
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Page header ----------
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-4 pb-3 pt-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
