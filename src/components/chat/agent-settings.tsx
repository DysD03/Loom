"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check, Settings2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setAgentConfigAction } from "@/app/agents/actions";

const STEP_MIN = 1;
const STEP_MAX = 30;

interface ToolItem {
  key: string;
  name: string;
  description: string;
  source: "builtin" | "mcp";
  serverName?: string;
}

export function AgentSettings({
  conversationId,
  maxSteps,
  enabledKeys,
}: {
  conversationId: string;
  /** Current effective step cap (default applied when none configured). */
  maxSteps: number;
  /** Currently enabled tool keys; null means all tools enabled. */
  enabledKeys: string[] | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState(maxSteps);
  const [enabled, setEnabled] = useState<string[] | null>(enabledKeys);
  const dirty = useRef(false);

  function loadTools() {
    setLoading(true);
    fetch("/api/tools")
      .then((res) => res.json())
      .then((data: { tools?: ToolItem[] }) => setTools(data.tools ?? []))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      loadTools();
      return;
    }
    // Persist on close, only if something changed.
    if (dirty.current) {
      dirty.current = false;
      const safeSteps = Math.min(STEP_MAX, Math.max(STEP_MIN, Math.floor(steps) || maxSteps));
      setAgentConfigAction(conversationId, { maxSteps: safeSteps, tools: enabled }).then(() =>
        router.refresh(),
      );
    }
  }

  const isChecked = (key: string) => enabled === null || enabled.includes(key);

  function toggle(key: string, checked: boolean) {
    dirty.current = true;
    const allKeys = tools.map((t) => t.key);
    const base = new Set(enabled === null ? allKeys : enabled);
    if (checked) base.add(key);
    else base.delete(key);
    setEnabled(base.size === allKeys.length ? null : [...base]);
  }

  const enabledCount = enabled === null ? tools.length : enabled.length;

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
          <Popover.Popup className="z-50 w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none">
            <p className="mb-3 text-sm font-semibold">Agent settings</p>

            <div className="mb-4 space-y-1.5">
              <label htmlFor="agent-max-steps" className="text-xs font-medium text-muted-foreground">
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
              <p className="text-[11px] text-muted-foreground">
                How many tool/reasoning steps the agent may take before stopping.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Tools ({enabledCount} enabled)
                </span>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {loading ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">Loading tools…</p>
                ) : tools.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    No tools available.
                  </p>
                ) : (
                  tools.map((t) => (
                    <label
                      key={t.key}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <Checkbox.Root
                        checked={isChecked(t.key)}
                        onCheckedChange={(checked) => toggle(t.key, checked === true)}
                        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-input data-[checked]:border-primary data-[checked]:bg-primary"
                      >
                        <Checkbox.Indicator>
                          <Check className="size-3 text-primary-foreground" />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-xs font-medium">
                          {t.source === "mcp" ? (
                            <Wrench className="size-3 shrink-0 text-muted-foreground" />
                          ) : null}
                          <span className="truncate">{t.name}</span>
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t.description}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
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
