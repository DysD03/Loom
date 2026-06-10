"use server";

import { revalidatePath } from "next/cache";

import { setResearchConfig, type ResearchConfig } from "@/lib/conversations";

export async function setResearchConfigAction(
  id: string,
  config: ResearchConfig,
): Promise<void> {
  setResearchConfig(id, config);
  revalidatePath("/research");
}
