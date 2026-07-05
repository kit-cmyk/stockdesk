"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Customers moved to their own section; redirect any old links. */
export default function CustomersSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/customers");
  }, [router]);
  return <div className="px-4 pt-6 text-muted">Redirecting…</div>;
}
