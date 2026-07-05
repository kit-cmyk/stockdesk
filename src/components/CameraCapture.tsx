"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { scaleToJpeg } from "@/lib/utils";

/**
 * Live device-camera photo capture. Shows a preview and a shutter button;
 * captured frames are downscaled to a JPEG data URL via onCapture.
 * Falls back to a message (and the parent's library picker) if no camera.
 */
export function CameraCapture({
  onCapture,
  onPickFile,
}: {
  onCapture: (dataUrl: string) => void;
  onPickFile?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch {
        if (!cancelled) setError("Camera unavailable or permission denied.");
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function shoot() {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    navigator.vibrate?.(40);
    onCapture(scaleToJpeg(video, w, h));
  }

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black ring-1 ring-border">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
            {error}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="button" className="flex-1" onClick={shoot} disabled={!ready}>
          {ready ? "Take photo" : "Starting camera…"}
        </Button>
        {onPickFile && (
          <Button type="button" variant="secondary" className="shrink-0" onClick={onPickFile}>
            Library
          </Button>
        )}
      </div>
    </div>
  );
}
