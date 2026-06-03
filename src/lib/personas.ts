import "server-only";

import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { personas, type Persona } from "@/db/schema";

const NAME_MAX = 60;
const DESC_MAX = 160;

/** Seeded the first time the Personas library is read, so the app is never empty. */
const DEFAULT_PERSONAS: ReadonlyArray<{
  name: string;
  description: string;
  systemPrompt: string;
}> = [
  {
    name: "Loom",
    description: "Balanced, helpful local assistant.",
    systemPrompt:
      "You are Loom, a helpful, clear-thinking assistant running locally on the user's machine. " +
      "You are direct and concise, you explain your reasoning when it helps, and you never invent facts.",
  },
  {
    name: "Senior Engineer",
    description: "Pragmatic, detail-oriented software engineer.",
    systemPrompt:
      "You are a senior software engineer. You favor correct, simple, maintainable solutions over clever ones. " +
      "You think about edge cases, failure modes, and trade-offs, and you back claims with concrete reasoning. " +
      "You write tight, idiomatic code and call out risks plainly.",
  },
  {
    name: "Skeptic",
    description: "Rigorous critic — great as the Critic voice.",
    systemPrompt:
      "You are a rigorous, constructive skeptic. You stress-test ideas: you hunt for hidden assumptions, missing cases, " +
      "logical gaps, and risks. You are specific and fair — you say exactly what is wrong and what would make it stronger, " +
      "never vague hand-waving.",
  },
  {
    name: "Researcher",
    description: "Thorough, source-driven investigator.",
    systemPrompt:
      "You are a meticulous researcher. You break questions into sub-questions, gather evidence, weigh competing claims, " +
      "and distinguish what is known from what is speculation. You cite sources when you have them and flag uncertainty.",
  },
];

let seeded = false;

/** Inserts the default personas once, if the table is empty. Idempotent per process. */
function ensureSeeded(): void {
  if (seeded) {
    return;
  }
  const existing = db.select({ id: personas.id }).from(personas).limit(1).get();
  if (!existing) {
    const now = new Date().toISOString();
    for (const p of DEFAULT_PERSONAS) {
      db.insert(personas)
        .values({ id: randomUUID(), builtin: true, createdAt: now, updatedAt: now, ...p })
        .run();
    }
  }
  seeded = true;
}

export function listPersonas(): Persona[] {
  ensureSeeded();
  return db.select().from(personas).orderBy(asc(personas.name)).all();
}

export function getPersona(id: string): Persona | undefined {
  return db.select().from(personas).where(eq(personas.id, id)).get();
}

export interface PersonaInput {
  name: string;
  description?: string;
  systemPrompt: string;
}

function clean(input: PersonaInput): {
  name: string;
  description: string;
  systemPrompt: string;
} {
  return {
    name: input.name.trim().slice(0, NAME_MAX) || "Untitled persona",
    description: (input.description ?? "").trim().slice(0, DESC_MAX),
    systemPrompt: input.systemPrompt.trim(),
  };
}

export function createPersona(input: PersonaInput): Persona {
  return db
    .insert(personas)
    .values({ id: randomUUID(), ...clean(input) })
    .returning()
    .get();
}

export function updatePersona(id: string, input: PersonaInput): Persona | undefined {
  return db
    .update(personas)
    .set({ ...clean(input), updatedAt: new Date().toISOString() })
    .where(eq(personas.id, id))
    .returning()
    .get();
}

export function deletePersona(id: string): void {
  db.delete(personas).where(eq(personas.id, id)).run();
}
