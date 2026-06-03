import "server-only";

/** Default tool-call/reasoning steps before the agent loop is forced to stop. */
export const AGENT_MAX_STEPS = 12;

/** Hard upper bound for a user-configured step cap (per-session control). */
export const AGENT_STEP_LIMIT = 30;

/**
 * System prompt for the Agents surface. Unlike plain chat, this nudges the model
 * to actually use the available tools in a loop and to report what it did.
 */
export const AGENT_SYSTEM_PROMPT =
  "You are Loom, an autonomous assistant running locally on the user's machine. " +
  "You have access to tools (web search and any connected MCP servers). " +
  "Work toward the user's goal step by step: decide when a tool would help, call it, " +
  "read the result, and continue until the task is done. Prefer calling a tool over " +
  "guessing when you lack information. Call tools one logical step at a time and use " +
  "their outputs to inform the next step. " +
  `You may take up to ${AGENT_MAX_STEPS} steps — be efficient and stop once you can fully answer. ` +
  "When finished, give a clear, concise summary in Markdown and cite any URLs you used.";

/** Default and ceiling for Solver↔Critic self-dialogue rounds. */
export const DIALOGUE_DEFAULT_ROUNDS = 2;
export const DIALOGUE_MAX_ROUNDS = 4;

const SOLVER_FALLBACK =
  "You are the Solver, a sharp, decisive problem-solver who proposes concrete approaches.";
const CRITIC_FALLBACK =
  "You are the Critic, a rigorous skeptic who stress-tests ideas to find their weak points.";

/** Composes the system prompt for the Solver voice in an internal dialogue. */
export function buildSolverSystem(personaPrompt?: string | null): string {
  const base = personaPrompt?.trim() || SOLVER_FALLBACK;
  return (
    `${base}\n\n` +
    "ROLE: You are the SOLVER in a private internal dialogue the assistant is using to think " +
    "through the user's task before answering. Propose — or, on later rounds, refine — a concrete " +
    "solution or plan. Directly address the Critic's objections from the previous round. Be specific " +
    "and reasoned. Keep it to a few tight paragraphs; do not address the user, address the problem."
  );
}

/** Composes the system prompt for the Critic voice in an internal dialogue. */
export function buildCriticSystem(personaPrompt?: string | null): string {
  const base = personaPrompt?.trim() || CRITIC_FALLBACK;
  return (
    `${base}\n\n` +
    "ROLE: You are the CRITIC in a private internal dialogue. Stress-test the Solver's latest " +
    "proposal: surface flawed assumptions, missing cases, errors, and risks. Be specific and " +
    "constructive — say exactly what is weak and what would make it stronger. If it is already " +
    "solid, say so briefly. Keep it concise."
  );
}

/** Builds the prompt for a single dialogue turn from the task and transcript so far. */
export function buildTurnPrompt(role: "Solver" | "Critic", task: string, transcript: string): string {
  return (
    `The user's task:\n${task}\n\n` +
    `Internal dialogue so far:\n${transcript.trim() || "(nothing yet — you go first)"}\n\n` +
    `Now respond as the ${role}.`
  );
}

/** Wraps the base system prompt with the deliberation transcript for the final answer. */
export function buildSynthesisSystem(base: string, transcript: string): string {
  return (
    `${base}\n\n` +
    "Before answering you held a private Solver/Critic deliberation. Use its conclusions to give the " +
    "strongest possible final answer to the user. Do NOT narrate or mention the deliberation — just " +
    `deliver the best answer.\n\nInternal deliberation:\n${transcript.trim()}`
  );
}
