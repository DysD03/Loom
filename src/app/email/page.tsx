import { getGmailAccount } from "@/lib/gmail/store";
import type { GmailStatus } from "@/lib/gmail/types";
import { EmailView } from "@/components/email/view";

export const dynamic = "force-dynamic";

interface EmailPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EmailPage({ searchParams }: EmailPageProps) {
  const params = await searchParams;
  const account = getGmailAccount();

  const status: GmailStatus = {
    configured: Boolean(account.clientId.trim() && account.clientSecret.trim()),
    connected: Boolean(account.refreshToken),
    email: account.email,
  };

  const error = typeof params.error === "string" ? params.error : null;
  const justConnected = params.connected === "1";

  return (
    <EmailView
      status={status}
      clientId={account.clientId}
      secretSet={Boolean(account.clientSecret.trim())}
      oauthError={error}
      justConnected={justConnected}
    />
  );
}
