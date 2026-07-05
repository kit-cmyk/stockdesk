"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, Field, Input, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useProfile } from "@/lib/hooks";
import { updateProfile } from "@/lib/repo";
import { signOut, updatePassword, useSession, DEMO_EMAIL } from "@/lib/auth";
import { fileToImage, scaleToJpeg } from "@/lib/utils";

export default function ProfileSettingsPage() {
  const router = useRouter();
  const profile = useProfile();
  const { session, demo, signedIn, email, cloudEnabled } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!profile) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const displayName = profile.owner_name?.trim() || profile.display_name;
  const initials = displayName
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function save(patch: Parameters<typeof updateProfile>[0]) {
    setSaving(true);
    try {
      await updateProfile(patch);
      toast("Saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const img = await fileToImage(file);
      // Avatars render small — 256px keeps IndexedDB light.
      await save({ avatar_data: scaleToJpeg(img, img.naturalWidth, img.naturalHeight, 256, 0.82) });
    } catch {
      toast("Could not read that image", "error");
    }
  }

  async function changePassword() {
    if (pw.length < 6) {
      toast("Password must be at least 6 characters", "error");
      return;
    }
    if (pw !== pw2) {
      toast("Passwords don't match", "error");
      return;
    }
    setPwBusy(true);
    const { error } = await updatePassword(pw);
    setPwBusy(false);
    if (error) {
      toast(error, "error");
      return;
    }
    setPw("");
    setPw2("");
    toast("Password updated", "success");
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      toast("Signed out", "success");
      router.push("/login");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div>
      <div className="px-4 pt-6">
        <button onClick={() => router.push("/settings")} className="text-sm text-primary">
          ← Settings
        </button>
      </div>
      <PageHeader title="Profile settings" subtitle="Manage how you appear and your account" />
      <div className="space-y-4 px-4 pb-8">
        <Card>
          <h2 className="mb-3 font-semibold">Your profile</h2>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-bold text-primary-fg ring-1 ring-border">
              {profile.avatar_data ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_data} alt="Profile photo" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" className="h-9 px-3" onClick={() => fileRef.current?.click()}>
                {profile.avatar_data ? "Change photo" : "Add photo"}
              </Button>
              {profile.avatar_data && (
                <Button
                  variant="ghost"
                  className="h-9 px-3 text-danger"
                  onClick={() => save({ avatar_data: undefined })}
                >
                  Remove photo
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
            </div>
          </div>
          <div className="mt-4">
            <Field label="Your name" hint="Shown in the account menu — separate from the business name.">
              <Input
                defaultValue={profile.owner_name ?? ""}
                placeholder="e.g. Kit Pimentel"
                onBlur={(e) => save({ owner_name: e.target.value.trim() || undefined })}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Account</h2>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Email</span>
              <span className="font-medium">{email ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Account type</span>
              <span className="font-medium">
                {demo ? "Sample account (this device)" : session ? "Cloud account" : cloudEnabled ? "Signed out" : "Local only"}
              </span>
            </div>
          </div>

          {cloudEnabled && session && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Change password</h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="New password">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                </Field>
                <Field label="Confirm">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                  />
                </Field>
              </div>
              <Button className="h-10 w-full" disabled={pwBusy || !pw} onClick={changePassword}>
                {pwBusy ? "Updating…" : "Update password"}
              </Button>
            </div>
          )}
          {demo && (
            <p className="mt-3 text-xs text-muted">
              The sample account&apos;s password is fixed ({DEMO_EMAIL} / stockdesk123). Password
              management unlocks once cloud accounts are enabled.
            </p>
          )}

          {signedIn && (
            <Button
              variant="ghost"
              className="mt-4 h-10 w-full text-danger"
              disabled={signingOut}
              onClick={handleSignOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          )}
        </Card>

        <p className="pt-2 text-center text-xs text-muted">{saving ? "Saving…" : "Changes save automatically"}</p>
      </div>
    </div>
  );
}
