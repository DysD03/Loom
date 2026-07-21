/**
 * Client-safe types + constants for the Email tab. No server imports here so
 * client components can use them (same pattern as lib/research-config.ts).
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export interface EmailAddress {
  name: string;
  email: string;
}

/** One row of the thread list (built from Gmail's metadata format). */
export interface ThreadSummary {
  id: string;
  subject: string;
  from: EmailAddress;
  /** Unix ms of the newest message. */
  date: number;
  snippet: string;
  unread: boolean;
  messageCount: number;
  lastMessageId: string;
}

export interface AttachmentMeta {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** RFC 2392 Content-ID with the angle brackets stripped (empty when absent). */
  contentId: string;
  /** True once the HTML body was found to embed this part via `cid:`. */
  inline: boolean;
}

/**
 * Local URL that streams one attachment's bytes. `inline` parts are served with
 * an inline Content-Disposition so the browser renders them in an `<img>`.
 */
export function attachmentUrl(
  attachment: AttachmentMeta,
  disposition: "inline" | "attachment",
): string {
  const params = new URLSearchParams({
    messageId: attachment.messageId,
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
  });
  if (disposition === "inline") {
    params.set("inline", "1");
  }
  return `/api/gmail/attachment?${params.toString()}`;
}

/** A fully parsed message of an open thread. */
export interface EmailMessage {
  id: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  /** Unix ms. */
  date: number;
  subject: string;
  snippet: string;
  /** Readable plain text (the text/plain part, or the HTML part stripped). */
  text: string;
  /** Raw HTML body when the message has one (rendered sandboxed on demand). */
  html: string | null;
  attachments: AttachmentMeta[];
  unread: boolean;
  /** RFC 5322 Message-ID header — needed to thread replies correctly. */
  rfcMessageId: string;
  /** RFC 5322 References header of this message (may be empty). */
  references: string;
  /** Reply-To recipients when the sender set them. */
  replyTo: EmailAddress[];
}

export interface ThreadDetail {
  id: string;
  subject: string;
  messages: EmailMessage[];
}

/** Connection status handed from the server page to the client view. */
export interface GmailStatus {
  /** OAuth client id + secret are saved. */
  configured: boolean;
  /** A refresh token exists (consent flow completed). */
  connected: boolean;
  email: string;
}

export const EMAIL_VIEWS = [
  { key: "inbox", label: "Inbox" },
  { key: "unread", label: "Unread" },
  { key: "sent", label: "Sent" },
  { key: "all", label: "All mail" },
] as const;

export type EmailViewKey = (typeof EMAIL_VIEWS)[number]["key"];

export function formatAddress(address: EmailAddress): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}
