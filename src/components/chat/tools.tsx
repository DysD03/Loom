"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setChatToolsAction } from "@/app/actions";

interface ToolItem {
  key: string;
  name: string;
  description: string;
  source: "builtin" | "mcp";
  serverName?: string;
}

/**
 * Per-conversation tool opt-in for plain Chat. Chat is lean by default — no
 * tool definitions are sent — and this popover enables specific tools for the
 * current conversation only (persisted in the shared `agent_tools` column,
 * where `null` means none for chat).
 */
export function ChatTools({
  conversationId,
  enabledKeys,
}: {
  conversationId: string;
  enabledKeys: string[] | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState<string[]>(enabledKeys ?? []);
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
    if (dirty.current) {
      dirty.current = false;
      setChatToolsAction(conversationId, enabled.length ? enabled : null).then(() =>
        router.refresh(),
      );
    }
  }

  function toggleTool(key: string, checked: boolean) {
    dirty.current = true;
    setEnabled((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)));
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <Button variant="outline" size="sm">
            <Wrench className="size-4" />
            Tools{enabled.length > 0 ? ` (${enabled.length})` : ""}
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="bg-popover text-popover-foreground z-50 w-[24rem] rounded-md border p-4 shadow-md outline-none">
            <div className="space-y-1.5">
              <span className="text-muted-foreground text-xs font-medium">
                Tools for this conversation ({enabled.length} enabled)
              </span>
              <p className="text-muted-foreground text-[11px]">
                Chat sends no tools by default — leaner prompts answer faster and better on
                local models. Enable only what this conversation needs.
              </p>
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
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
                        checked={enabled.includes(t.key)}
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
            <div className="mt-3 flex justify-end">
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
