"use client";

// Last-resort boundary (errors thrown in the root layout itself). Must render
// its own <html>/<body> because the layout is gone.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>StockDesk hit an unexpected error</h1>
        <p style={{ color: "#667", maxWidth: 420, margin: "0.5rem auto" }}>
          {error.message || "Something went wrong."} Your data is stored on this device and is not
          lost.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1.25rem",
            padding: "0.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "none",
            background: "#2563eb",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
