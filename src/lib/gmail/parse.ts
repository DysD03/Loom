import "server-only";

import { htmlToText } from "@/lib/web";
import { attachmentUrl, type AttachmentMeta, type EmailAddress, type EmailMessage } from "./types";

// ---------------------------------------------------------------------------
// Gmail API payload shapes (the subset we read)
// ---------------------------------------------------------------------------

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

export interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayload[];
}

export interface GmailMessageRaw {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}

// ---------------------------------------------------------------------------
// Header + address parsing
// ---------------------------------------------------------------------------

export function headerValue(payload: GmailPayload | undefined, name: string): string {
  const lower = name.toLowerCase();
  return payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

/** Splits an address-list header on commas that are outside quotes and <...>. */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "<" && !inQuotes) inAngle = true;
    else if (ch === ">" && !inQuotes) inAngle = false;
    if (ch === "," && !inQuotes && !inAngle) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parses `Name <a@b>, "Last, First" <c@d>, e@f` into structured addresses. */
export function parseAddressList(value: string): EmailAddress[] {
  return splitAddressList(value).map((token) => {
    const match = token.match(/^(.*)<([^<>]+)>\s*$/);
    if (match) {
      const name = match[1].trim().replace(/^"(.*)"$/, "$1").trim();
      return { name, email: match[2].trim() };
    }
    return { name: "", email: token.replace(/^"(.*)"$/, "$1").trim() };
  });
}

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

function charsetOf(payload: GmailPayload): string {
  const contentType = headerValue(payload, "Content-Type");
  const match = contentType.match(/charset="?([\w-]+)"?/i);
  return match ? match[1] : "utf-8";
}

function decodeBody(data: string, charset: string): string {
  const bytes = Buffer.from(data, "base64url");
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Depth-first walk collecting the first text/plain and text/html bodies. */
function collectBodies(
  payload: GmailPayload,
  acc: { text?: string; html?: string },
): void {
  const mime = (payload.mimeType ?? "").toLowerCase();
  const data = payload.body?.data;
  const isInline = !payload.filename;

  if (data && isInline && mime === "text/plain" && acc.text === undefined) {
    acc.text = decodeBody(data, charsetOf(payload));
  } else if (data && isInline && mime === "text/html" && acc.html === undefined) {
    acc.html = decodeBody(data, charsetOf(payload));
  }

  for (const part of payload.parts ?? []) {
    collectBodies(part, acc);
  }
}

/** `<abc@mail>` → `abc@mail`. Empty for parts that aren't body-embedded. */
function contentIdOf(part: GmailPayload): string {
  return headerValue(part, "Content-ID").trim().replace(/^<|>$/g, "");
}

function collectAttachments(messageId: string, payload: GmailPayload): AttachmentMeta[] {
  const found: AttachmentMeta[] = [];
  const walk = (part: GmailPayload) => {
    const contentId = contentIdOf(part);
    // Embedded images often arrive with an empty filename but always carry a
    // Content-ID, so either one is enough to make the part addressable.
    if (part.body?.attachmentId && (part.filename || contentId)) {
      found.push({
        messageId,
        attachmentId: part.body.attachmentId,
        filename: part.filename || contentId || "attachment",
        mimeType: part.mimeType ?? "application/octet-stream",
        sizeBytes: part.body.size ?? 0,
        contentId,
        inline: false,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return found;
}

/**
 * Points `cid:` references at our own attachment route so images embedded in
 * the body actually render — browsers can't resolve `cid:` themselves. Parts
 * that get consumed are flagged `inline` so they don't also show up as
 * downloadable attachments.
 *
 * The generated URLs keep bare `&` separators: none of the parameter names
 * begin a valid HTML entity, and escaping would corrupt the `url(cid:…)` form
 * inside `<style>` blocks, where entities are not decoded.
 */
function inlineCidImages(html: string, attachments: AttachmentMeta[]): string {
  const byContentId = new Map(
    attachments.filter((a) => a.contentId).map((a) => [a.contentId.toLowerCase(), a]),
  );
  if (byContentId.size === 0) {
    return html;
  }

  return html.replace(
    /(["'(])\s*cid:([^"')\s]+)\s*(["')])/gi,
    (whole: string, open: string, id: string, close: string) => {
      const part = byContentId.get(decodeURIComponent(id).toLowerCase());
      if (!part) return whole;
      part.inline = true;
      return `${open}${attachmentUrl(part, "inline")}${close}`;
    },
  );
}

/** Decodes the HTML entities Gmail leaves in snippets. */
export function decodeSnippet(snippet: string): string {
  return snippet
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}

/** Parses a full-format Gmail message into the shape the UI + LLM consume. */
export function parseMessage(raw: GmailMessageRaw): EmailMessage {
  const payload = raw.payload ?? {};
  const bodies: { text?: string; html?: string } = {};
  collectBodies(payload, bodies);

  const attachments = collectAttachments(raw.id, payload);
  const rawHtml = bodies.html ?? null;
  const html = rawHtml ? inlineCidImages(rawHtml, attachments) : null;
  const text = (bodies.text ?? (rawHtml ? htmlToText(rawHtml) : "")).trim();
  const fromList = parseAddressList(headerValue(payload, "From"));

  return {
    id: raw.id,
    from: fromList[0] ?? { name: "", email: "" },
    to: parseAddressList(headerValue(payload, "To")),
    cc: parseAddressList(headerValue(payload, "Cc")),
    date: Number(raw.internalDate ?? 0) || 0,
    subject: headerValue(payload, "Subject"),
    snippet: decodeSnippet(raw.snippet ?? ""),
    text,
    html,
    attachments,
    unread: (raw.labelIds ?? []).includes("UNREAD"),
    rfcMessageId: headerValue(payload, "Message-ID") || headerValue(payload, "Message-Id"),
    references: headerValue(payload, "References"),
    replyTo: parseAddressList(headerValue(payload, "Reply-To")),
  };
}

// ---------------------------------------------------------------------------
// Outgoing MIME (RFC 5322) building
// ---------------------------------------------------------------------------

/** RFC 2047-encodes a header word when it contains non-ASCII characters. */
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatMimeAddress(address: EmailAddress): string {
  if (!address.name) {
    return address.email;
  }
  const safe = /^[A-Za-z0-9 .'_-]*$/.test(address.name);
  const name = safe ? address.name : encodeHeaderWord(address.name);
  return `${name} <${address.email}>`;
}

export interface OutgoingEmail {
  from: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}

/** Builds a base64url-encoded RFC 5322 message for `users.messages.send`. */
export function buildRawEmail(mail: OutgoingEmail): string {
  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to.map(formatMimeAddress).join(", ")}`,
  ];
  if (mail.cc?.length) {
    headers.push(`Cc: ${mail.cc.map(formatMimeAddress).join(", ")}`);
  }
  headers.push(`Subject: ${encodeHeaderWord(mail.subject)}`);
  if (mail.inReplyTo) {
    headers.push(`In-Reply-To: ${mail.inReplyTo}`);
  }
  if (mail.references) {
    headers.push(`References: ${mail.references}`);
  }
  headers.push(
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  );

  const body = Buffer.from(mail.text, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");

  const mime = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return Buffer.from(mime, "utf8").toString("base64url");
}

export function replySubject(original: string): string {
  const subject = original.trim() || "(no subject)";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** Reply threading headers derived from the message being replied to. */
export function replyHeaders(target: EmailMessage): {
  inReplyTo?: string;
  references?: string;
} {
  const references = [target.references, target.rfcMessageId]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    inReplyTo: target.rfcMessageId || undefined,
    references: references || undefined,
  };
}

function dedupe(addresses: EmailAddress[]): EmailAddress[] {
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const key = a.email.toLowerCase();
    if (!a.email || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Computes reply recipients: the target's Reply-To (or From), plus — on
 * reply-all — everyone else on the message, always excluding the connected
 * account itself. Replying to your own sent message falls back to its
 * original recipients so the thread keeps flowing to the right people.
 */
export function replyRecipients(
  target: EmailMessage,
  selfEmail: string,
  replyAll: boolean,
): { to: EmailAddress[]; cc: EmailAddress[] } {
  const self = selfEmail.toLowerCase();
  const notSelf = (a: EmailAddress) => a.email.toLowerCase() !== self;

  const primary = target.replyTo.length > 0 ? target.replyTo : [target.from];
  let to = dedupe(primary.filter(notSelf));
  if (to.length === 0) {
    // The target is our own message — keep sending to its recipients.
    to = dedupe(target.to.filter(notSelf));
  }

  if (!replyAll) {
    return { to, cc: [] };
  }

  const toKeys = new Set(to.map((a) => a.email.toLowerCase()));
  const rest = dedupe(
    [...target.to, ...target.cc].filter(
      (a) => notSelf(a) && !toKeys.has(a.email.toLowerCase()),
    ),
  );
  return { to, cc: rest };
}
