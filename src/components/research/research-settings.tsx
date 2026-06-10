"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check, Settings2 } from "lucide-react";

import {
  RESEARCH_ROUNDS_MAX,
  RESEARCH_ROUNDS_MIN,
  type ResearchConfig,
  type ResearchToolKey,
} from "@/lib/research-config";
import { Button } from "@/components/ui/button";
import { setResearchConfigAction } from "@/app/research/actions";

const TOOL_INFO: { key: ResearchToolKey; name: string; description: string }[] = [
  { key: "searchWeb", name: "Web search", description: "Discover sources via SearXNG" },
  {
    key: "readUrl",
    name: "Read full pages",
    description: "Fetch and read each source (off = use snippets only)",
  },
  {
    key: "searchDocuments",
    name: "Local documents",
    description: "Also draw on your uploaded knowledge base",
  },
];

export function ResearchSettings({
  conversationId,
  config,
  disabled,
}: {
  conversationId: string;
  config: ResearchConfig;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rounds, setRounds] = useState(config.maxRounds);
  const [tools, setTools] = useState<ResearchToolKey[]>(config.tools);
  const dirty = useRef(false);

  function persist() {
    const safeRounds = Math.min(
      RESEARCH_ROUNDS_MAX,
      Math.max(RESEARCH_ROUNDS_MIN, Math.floor(rounds) || config.maxRounds),
    );
    return setResearchConfigAction(conversationId, { maxRounds: safeRounds, tools }).then(() =>
      router.refresh(),
    );
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && dirty.current) {
      dirty.current = false;
      persist();
    }
  }

  function toggleTool(key: ResearchToolKey, checked: boolean) {
    dirty.current = true;
    setTools((prev) => {
      const set = new Set(prev);
      if (checked) set.add(key);
      else set.delete(key);
      return TOOL_INFO.map((t) => t.key).filter((k) => set.has(k));
    });
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <Button variant="outline" size="sm" disabled={disabled}>
            <Settings2 className="size-4" />
            Research
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="bg-popover text-popover-foreground z-50 w-[22rem] rounded-md border p-4 shadow-md outline-none">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="research-rounds"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Research rounds ({RESEARCH_ROUNDS_MIN}–{RESEARCH_ROUNDS_MAX})
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="research-rounds"
                    type="range"
                    min={RESEARCH_ROUNDS_MIN}
                    max={RESEARCH_ROUNDS_MAX}
                    value={rounds}
                    onChange={(e) => {
                      dirty.current = true;
                      setRounds(Number(e.target.value));
                    }}
                    className="accent-primary h-1.5 flex-1"
                  />
                  <span className="text-foreground w-16 text-right text-xs tabular-nums">
                    {rounds} {rounds === 1 ? "round" : "rounds"}
                  </span>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Each round searches, reads, then reflects on gaps before digging deeper. More
                  rounds = more thorough but slower.
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="text-muted-foreground text-xs font-medium">Tools &amp; sources</span>
                <div className="space-y-1">
                  {TOOL_INFO.map((t) => (
                    <label
                      key={t.key}
                      className="hover:bg-accent flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5"
                    >
                      <Checkbox.Root
                        checked={tools.includes(t.key)}
                        onCheckedChange={(checked) => toggleTool(t.key, checked === true)}
                        className="border-input data-[checked]:border-primary data-[checked]:bg-primary mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border"
                      >
                        <Checkbox.Indicator>
                          <Check className="text-primary-foreground size-3" />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{t.name}</span>
                        <span className="text-muted-foreground block text-[11px]">
                          {t.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-muted-foreground text-[11px]">
                {rounds}× · {tools.length} source{tools.length === 1 ? "" : "s"}
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
