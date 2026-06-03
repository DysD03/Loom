"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check, Pencil, Plus, Settings2, Trash2, Wrench } from "lucide-react";

import type { Persona } from "@/db/schema";
import type { AgentConfig, SelfDialogueConfig } from "@/lib/conversations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  createPersonaAction,
  deletePersonaAction,
  setAgentConfigAction,
  updatePersonaAction,
} from "@/app/agents/actions";

const STEP_MIN = 1;
const STEP_MAX = 30;
const DIALOGUE_MAX_ROUNDS = 4;

interface ToolItem {
  key: string;
  name: string;
  description: string;
  source: "builtin" | "mcp";
  serverName?: string;
}

interface PersonaDraft {
  id: string | null; // null => creating a new persona
  name: string;
  description: string;
  systemPrompt: string;
}

const EMPTY_DRAFT: PersonaDraft = { id: null, name: "", description: "", systemPrompt: "" };

/** Styled native <select> — robust for the dense settings panel. */
function MiniSelect({
  value,
  onChange,
  children,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2 text-sm outline-none focus-visible:ring-3"
    >
      {children}
    </select>
  );
}

export function AgentSettings({
  conversationId,
  maxSteps,
  enabledKeys,
  personas,
  personaId,
  selfDialogue,
}: {
  conversationId: string;
  maxSteps: number;
  enabledKeys: string[] | null;
  /** Reusable persona library (server-provided, seeded with defaults). */
  personas: Persona[];
  /** Persona assigned to this session; null means the built-in identity. */
  personaId: string | null;
  selfDialogue: SelfDialogueConfig;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [steps, setSteps] = useState(maxSteps);
  const [enabled, setEnabled] = useState<string[] | null>(enabledKeys);
  const [persona, setPersona] = useState<string | null>(personaId);
  const [sd, setSd] = useState<SelfDialogueConfig>(selfDialogue);
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const dirty = useRef(false);

  function loadTools() {
    setLoading(true);
    fetch("/api/tools")
      .then((res) => res.json())
      .then((data: { tools?: ToolItem[] }) => setTools(data.tools ?? []))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }

  function persist() {
    const safeSteps = Math.min(STEP_MAX, Math.max(STEP_MIN, Math.floor(steps) || maxSteps));
    const config: AgentConfig = {
      maxSteps: safeSteps,
      tools: enabled,
      personaId: persona,
      selfDialogue: sd,
    };
    return setAgentConfigAction(conversationId, config).then(() => router.refresh());
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      loadTools();
      return;
    }
    setDraft(null);
    if (dirty.current) {
      dirty.current = false;
      persist();
    }
  }

  const isChecked = (key: string) => enabled === null || enabled.includes(key);

  function toggleTool(key: string, checked: boolean) {
    dirty.current = true;
    const allKeys = tools.map((t) => t.key);
    const base = new Set(enabled === null ? allKeys : enabled);
    if (checked) base.add(key);
    else base.delete(key);
    setEnabled(base.size === allKeys.length ? null : [...base]);
  }

  function patchSd(patch: Partial<SelfDialogueConfig>) {
    dirty.current = true;
    setSd((prev) => ({ ...prev, ...patch }));
  }

  async function saveDraft() {
    if (!draft || !draft.systemPrompt.trim()) return;
    const input = {
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
    };
    if (draft.id) {
      await updatePersonaAction(draft.id, input);
    } else {
      const created = await createPersonaAction(input);
      // Auto-assign a freshly created persona to this session.
      dirty.current = true;
      setPersona(created.id);
    }
    setDraft(null);
    router.refresh();
  }

  async function removePersona(id: string) {
    await deletePersonaAction(id);
    // Drop any references to the deleted persona.
    if (persona === id) {
      dirty.current = true;
      setPersona(null);
    }
    if (sd.solverPersonaId === id || sd.criticPersonaId === id) {
      patchSd({
        solverPersonaId: sd.solverPersonaId === id ? null : sd.solverPersonaId,
        criticPersonaId: sd.criticPersonaId === id ? null : sd.criticPersonaId,
      });
    }
    router.refresh();
  }

  const enabledCount = enabled === null ? tools.length : enabled.length;
  const currentPersonaName = personas.find((p) => p.id === persona)?.name ?? "Default";

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <Button variant="outline" size="sm">
            <Settings2 className="size-4" />
            Agent
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="bg-popover text-popover-foreground z-50 w-[26rem] rounded-md border p-4 shadow-md outline-none">
            <Tabs defaultValue="persona">
              <TabsList>
                <TabsTab value="persona">Persona</TabsTab>
                <TabsTab value="reasoning">Reasoning</TabsTab>
                <TabsTab value="tools">Tools</TabsTab>
              </TabsList>

              {/* ---------------- Persona ---------------- */}
              <TabsPanel value="persona" className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="persona-select" className="text-muted-foreground text-xs font-medium">
                    Session persona
                  </label>
                  <MiniSelect
                    id="persona-select"
                    value={persona ?? ""}
                    onChange={(v) => {
                      dirty.current = true;
                      setPersona(v || null);
                    }}
                  >
                    <option value="">Default (built-in Loom identity)</option>
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </MiniSelect>
                  <p className="text-muted-foreground text-[11px]">
                    The persona shapes the agent&apos;s voice and approach for this session.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium">Library</span>
                    {draft === null ? (
                      <Button size="xs" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                        <Plus className="size-3" />
                        New
                      </Button>
                    ) : null}
                  </div>

                  {draft ? (
                    <div className="border-border/60 space-y-2 rounded-md border p-2.5">
                      <Input
                        placeholder="Name"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="h-7"
                      />
                      <Input
                        placeholder="Short description (optional)"
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        className="h-7"
                      />
                      <Textarea
                        placeholder="System prompt — who this persona is and how it behaves…"
                        value={draft.systemPrompt}
                        onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                        rows={4}
                        className="min-h-[88px] text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
                          Cancel
                        </Button>
                        <Button size="xs" onClick={saveDraft} disabled={!draft.systemPrompt.trim()}>
                          {draft.id ? "Save" : "Create"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                      {personas.map((p) => (
                        <div
                          key={p.id}
                          className="hover:bg-accent group flex items-start gap-2 rounded-md px-2 py-1.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{p.name}</span>
                            {p.description ? (
                              <span className="text-muted-foreground block truncate text-[11px]">
                                {p.description}
                              </span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            aria-label={`Edit ${p.name}`}
                            onClick={() =>
                              setDraft({
                                id: p.id,
                                name: p.name,
                                description: p.description,
                                systemPrompt: p.systemPrompt,
                              })
                            }
                            className="text-muted-foreground hover:text-foreground opacity-0 transition group-hover:opacity-100"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${p.name}`}
                            onClick={() => removePersona(p.id)}
                            className="text-muted-foreground hover:text-destructive opacity-0 transition group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsPanel>

              {/* ---------------- Reasoning (self-dialogue) ---------------- */}
              <TabsPanel value="reasoning" className="space-y-3">
                <label className="hover:bg-accent flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5">
                  <Checkbox.Root
                    checked={sd.enabled}
                    onCheckedChange={(checked) => patchSd({ enabled: checked === true })}
                    className="border-input data-[checked]:border-primary data-[checked]:bg-primary mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border"
                  >
                    <Checkbox.Indicator>
                      <Check className="text-primary-foreground size-3" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">Self-dialogue</span>
                    <span className="text-muted-foreground block text-[11px]">
                      The agent debates itself (Solver ↔ Critic) before answering.
                    </span>
                  </span>
                </label>

                <div
                  className={
                    sd.enabled ? "space-y-3" : "pointer-events-none space-y-3 opacity-40"
                  }
                >
                  <div className="space-y-1.5">
                    <label htmlFor="sd-rounds" className="text-muted-foreground text-xs font-medium">
                      Rounds
                    </label>
                    <MiniSelect
                      id="sd-rounds"
                      value={String(sd.rounds)}
                      onChange={(v) => patchSd({ rounds: Number(v) })}
                    >
                      {Array.from({ length: DIALOGUE_MAX_ROUNDS }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? "round" : "rounds"}
                        </option>
                      ))}
                    </MiniSelect>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="sd-solver" className="text-muted-foreground text-xs font-medium">
                      Solver voice
                    </label>
                    <MiniSelect
                      id="sd-solver"
                      value={sd.solverPersonaId ?? ""}
                      onChange={(v) => patchSd({ solverPersonaId: v || null })}
                    >
                      <option value="">Built-in Solver</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </MiniSelect>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="sd-critic" className="text-muted-foreground text-xs font-medium">
                      Critic voice
                    </label>
                    <MiniSelect
                      id="sd-critic"
                      value={sd.criticPersonaId ?? ""}
                      onChange={(v) => patchSd({ criticPersonaId: v || null })}
                    >
                      <option value="">Built-in Critic</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </MiniSelect>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    The debate streams as collapsible thoughts; only the final synthesis answers
                    the user. More rounds = slower but more thorough.
                  </p>
                </div>
              </TabsPanel>

              {/* ---------------- Tools ---------------- */}
              <TabsPanel value="tools" className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="agent-max-steps" className="text-muted-foreground text-xs font-medium">
                    Max steps ({STEP_MIN}–{STEP_MAX})
                  </label>
                  <Input
                    id="agent-max-steps"
                    type="number"
                    min={STEP_MIN}
                    max={STEP_MAX}
                    value={steps}
                    onChange={(e) => {
                      dirty.current = true;
                      setSteps(Number(e.target.value));
                    }}
                    className="h-8"
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-muted-foreground text-xs font-medium">
                    Tools ({enabledCount} enabled)
                  </span>
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {loading ? (
                      <p className="text-muted-foreground py-3 text-center text-xs">Loading tools…</p>
                    ) : tools.length === 0 ? (
                      <p className="text-muted-foreground py-3 text-center text-xs">
                        No tools available.
                      </p>
                    ) : (
                      tools.map((t) => (
                        <label
                          key={t.key}
                          className="hover:bg-accent flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5"
                        >
                          <Checkbox.Root
                            checked={isChecked(t.key)}
                            onCheckedChange={(checked) => toggleTool(t.key, checked === true)}
                            className="border-input data-[checked]:border-primary data-[checked]:bg-primary mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border"
                          >
                            <Checkbox.Indicator>
                              <Check className="text-primary-foreground size-3" />
                            </Checkbox.Indicator>
                          </Checkbox.Root>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-xs font-medium">
                              {t.source === "mcp" ? (
                                <Wrench className="text-muted-foreground size-3 shrink-0" />
                              ) : null}
                              <span className="truncate">{t.name}</span>
                            </span>
                            <span className="text-muted-foreground block truncate text-[11px]">
                              {t.description}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </TabsPanel>
            </Tabs>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-muted-foreground text-[11px]">
                {currentPersonaName}
                {sd.enabled ? ` · self-dialogue ×${sd.rounds}` : ""}
              </span>
              <Popover.Close
                render={
                  <Button size="sm" variant="secondary">
                    Done
                  </Button>
                }
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
