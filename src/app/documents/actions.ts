"use server";

import { revalidatePath } from "next/cache";

import { deleteDocument, renameDocument } from "@/lib/documents";

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
