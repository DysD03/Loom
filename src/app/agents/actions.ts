"use server";

import { revalidatePath } from "next/cache";

import { setAgentConfig, type AgentConfig } from "@/lib/conversations";

export async function setAgentConfigAction(id: string, config: AgentConfig): Promise<void> {
  setAgentConfig(id, config);
  revalidatePath("/agents");
}
