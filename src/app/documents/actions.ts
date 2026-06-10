"use server";

import { revalidatePath } from "next/cache";

import { deleteDocument, ingestUrlDocument, renameDocument } from "@/lib/documents";

export async function ingestUrlAction(
  url: string,
): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: "Enter a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs are supported." };
  }

  try {
    const doc = await ingestUrlDocument(parsed.toString());
    revalidatePath("/documents");
    if (doc.status === "error") {
      return { ok: false, error: doc.error ?? "Failed to ingest the page." };
    }
    return { ok: true, title: doc.title };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to ingest the page." };
  }
}

export async function deleteDocumentAction(id: string): Promise<void> {
  deleteDocument(id);
  revalidatePath("/documents");
}

export async function renameDocumentAction(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    return;
  }
  renameDocument(id, trimmed);
  revalidatePath("/documents");
}
