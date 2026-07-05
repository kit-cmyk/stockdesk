"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Button, Input } from "./ui";

/** Human message per camera failure mode, so the user knows how to recover. */
function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera access is blocked. Allow the camera for this site in your browser settings, then tap Retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device. Enter the barcode manually below.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is in use by another app. Close it and tap Retry.";
    case "OverconstrainedError":
      return "The camera doesn't support scanning here. Enter the barcode manually below.";
    case "SecurityError":
      return "Camera needs a secure (https) connection. Enter the barcode manually below.";
    default:
      return "Camera unavailable. Enter the barcode manually below.";
  }
}

/**
 * Camera barcode scanner. Calls onResult with the decoded text.
 * Falls back to manual entry if the camera is unavailable or denied.
 */
export function Scanner({ onResult }: { onResult: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [attempt, setAttempt] = useState(0); // bump to retry the camera

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    (async () => {
      try {
        setError(null);
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (result && !cancelled) {
              navigator.vibrate?.(60);
              onResult(result.getText());
            }
          }
        );
        controlsRef.current = controls;
      } catch (err) {
        if (!cancelled) setError(cameraErrorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [attempt, onResult]);

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black ring-1 ring-border">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-56 rounded-xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
            <span>{error}</span>
            <Button
              type="button"
              variant="secondary"
              className="h-10 px-4"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry camera
            </Button>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onResult(manual.trim());
        }}
        className="flex gap-2"
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or type a barcode / SKU"
        />
        <Button type="submit" variant="secondary" className="shrink-0">
          Find
        </Button>
      </form>
    </div>
  );
}
