import "server-only";

/** A document kind we know how to parse. */
export type DocumentKind = "pdf" | "markdown" | "text";

/** Maps a filename + MIME type to a parser kind. Unknown types fall back to plain text. */
export function detectKind(filename: string, mimeType: string): DocumentKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (ext === "md" || ext === "markdown" || mimeType === "text/markdown") {
    return "markdown";
  }
  return "text";
}

/** Extensions accepted by the uploader. Used for the file input + validation. */
export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".log",
  ".tsv",
  ".yaml",
  ".yml",
] as const;

/** Normalizes whitespace so chunking and embeddings aren't polluted by layout noise. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extracts readable text from a PDF using unpdf (pure-JS, no native deps). */
async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

/**
 * Extracts plain text from an uploaded file buffer based on its detected kind.
 * Text-like formats are decoded as UTF-8; PDFs go through unpdf. Throws when the
 * result is empty so the caller can surface a clear "no extractable text" error.
 */
export async function extractText(
  buffer: ArrayBuffer,
  kind: DocumentKind,
): Promise<string> {
  let raw: string;
  if (kind === "pdf") {
    raw = await extractPdf(new Uint8Array(buffer));
  } else {
    raw = new TextDecoder("utf-8").decode(buffer);
  }
  const text = normalizeText(raw);
  if (!text) {
    throw new Error("No extractable text found in the file.");
  }
  return text;
}
