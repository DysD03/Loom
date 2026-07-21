"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/copy-button";
import { saveGmailCredentialsAction } from "@/app/email/actions";

interface ConnectProps {
  clientId: string;
  secretSet: boolean;
  oauthError: string | null;
}

/** Setup + consent card shown while no Gmail account is connected. */
export function Connect({ clientId, secretSet, oauthError }: ConnectProps) {
  const [id, setId] = useState(clientId);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(clientId) && secretSet);
  const [redirectUri, setRedirectUri] = useState("");

  // window is unavailable during SSR — resolve the redirect URI after mount
  // (async so the effect body itself never sets state synchronously).
  useEffect(() => {
    const id = window.setTimeout(
      () => setRedirectUri(`${window.location.origin}/api/gmail/oauth/callback`),
      0,
    );
    return () => window.clearTimeout(id);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await saveGmailCredentialsAction(id, secret);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSaved(true);
      toast.success("Google OAuth client saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-8">
      <div className="w-full max-w-2xl space-y-6 rounded-xl border bg-card p-6">
        <div className="flex items-center gap-3">
          <Mail className="size-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Connect Gmail</h2>
            <p className="text-sm text-muted-foreground">
              Loom talks to Gmail directly with your own Google OAuth client. Tokens stay
              in the local database — nothing goes through a third party.
            </p>
          </div>
        </div>

        {oauthError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>{oauthError}</p>
          </div>
        ) : null}

        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            In the{" "}
            <a
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Google Cloud console
            </a>
            , create (or pick) a project and enable the <strong>Gmail API</strong>.
          </li>
          <li>
            Configure the OAuth consent screen (User type <strong>External</strong>) and
            add your own address as a test user. To avoid weekly token expiry, publish
            the app to <strong>Production</strong> — Google shows an “unverified app”
            warning you can click through, since only you use it.
          </li>
          <li>
            Create credentials → <strong>OAuth client ID</strong> → type{" "}
            <strong>Web application</strong>, and register this exact redirect URI:
            <span className="mt-1 flex items-center gap-1 font-mono text-xs text-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5">
                {redirectUri || "…"}
              </code>
              {redirectUri ? <CopyButton value={redirectUri} /> : null}
            </span>
          </li>
          <li>Paste the client id + secret below, save, then connect.</li>
        </ol>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gmail-client-id">Client id</Label>
            <Input
              id="gmail-client-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="1234567890-abc123.apps.googleusercontent.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gmail-client-secret">Client secret</Label>
            <Input
              id="gmail-client-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={secretSet ? "•••••• (saved — leave blank to keep)" : "GOCSPX-…"}
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSave} disabled={saving || !id.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              onClick={() => {
                window.location.href = "/api/gmail/oauth/start";
              }}
              disabled={!saved}
            >
              <Mail className="size-4" />
              Connect Google account
            </Button>
            {!saved ? (
              <span className="text-xs text-muted-foreground">Save the client first.</span>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Scope requested: <code>gmail.modify</code> — read, reply, archive and mark
          read/unread. Loom never deletes mail.
        </p>
      </div>
    </div>
  );
}
