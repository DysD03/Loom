"use server";

import { revalidatePath } from "next/cache";

import { disconnectGmail, getGmailAccount, updateGmailAccount } from "@/lib/gmail/store";

/**
 * Saves the user's Google OAuth client. A blank secret keeps the stored one so
 * the form can show "saved" without round-tripping the secret to the client.
 */
export async function saveGmailCredentialsAction(clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id) {
    return { error: "Client id is required." };
  }
  const existing = getGmailAccount();
  if (!secret && !existing.clientSecret) {
    return { error: "Client secret is required." };
  }
  updateGmailAccount({ clientId: id, ...(secret ? { clientSecret: secret } : {}) });
  revalidatePath("/email");
  return { ok: true as const };
}

/** Drops tokens + identity (keeps the OAuth client for easy reconnects). */
export async function disconnectGmailAction() {
  disconnectGmail();
  revalidatePath("/email");
  return { ok: true as const };
}
