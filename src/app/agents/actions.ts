"use server";

import { revalidatePath } from "next/cache";

import { setAgentConfig, type AgentConfig } from "@/lib/conversations";
import {
  createPersona,
  deletePersona,
  updatePersona,
  type PersonaInput,
} from "@/lib/personas";
import type { Persona } from "@/db/schema";

export async function setAgentConfigAction(id: string, config: AgentConfig): Promise<void> {
  setAgentConfig(id, config);
  revalidatePath("/agents");
}

export async function createPersonaAction(input: PersonaInput): Promise<Persona> {
  const persona = createPersona(input);
  revalidatePath("/agents");
  return persona;
}

export async function updatePersonaAction(
  id: string,
  input: PersonaInput,
): Promise<Persona | null> {
  const persona = updatePersona(id, input);
  revalidatePath("/agents");
  return persona ?? null;
}

export async function deletePersonaAction(id: string): Promise<void> {
  deletePersona(id);
  revalidatePath("/agents");
}
