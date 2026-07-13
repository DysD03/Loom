"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CLOUD_CATALOG, type CloudProvider } from "@/lib/models";

interface ModelsResponse {
  models?: string[];
  cloudProviders?: CloudProvider[];
  error?: string;
}

function ModelChip({
  label,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled && !selected}
      className={cn(
        "flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs transition-colors",
        selected
          ? "border-neon-cyan text-neon-cyan bg-accent/60"
          : "text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground disabled:opacity-40",
      )}
    >
      {selected ? <Check className="size-3" /> : null}
      {label}
    </button>
  );
}

/**
 * Multi-select of models to compare: everything the local endpoint exposes,
 * curated models for each cloud provider with an API key, plus free-text ids.
 */
export function ModelPicker({
  selected,
  onChange,
  max,
  disabled = false,
}: {
  selected: string[];
  onChange: (models: string[]) => void;
  max: number;
  disabled?: boolean;
}) {
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/llm/models")
      .then((res) => res.json())
      .then((data: ModelsResponse) => {
        if (cancelled) return;
        setLocalModels(data.models ?? []);
        setCloudProviders(data.cloudProviders ?? []);
        setLocalError(data.error ?? null);
      })
      .catch(() => {
        if (!cancelled) setLocalError("Could not reach the local endpoint.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const atCap = selected.length >= max;

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((m) => m !== id));
      return;
    }
    if (atCap) {
      toast.warning(`Compare at most ${max} models per run.`);
      return;
    }
    onChange([...selected, id]);
  }

  function addCustom() {
    const id = custom.trim();
    if (!id) return;
    setCustom("");
    toggle(id);
  }

  const cloudGroups = CLOUD_CATALOG.filter((group) => cloudProviders.includes(group.provider));
  const knownIds = new Set([
    ...localModels,
    ...CLOUD_CATALOG.flatMap((g) => g.models.map((m) => m.id)),
  ]);
  const customSelected = selected.filter((m) => !knownIds.has(m));

  return (
    <div className={cn("space-y-3", disabled && "pointer-events-none opacity-60")}>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Models to compare</p>
        <p className="text-muted-foreground text-xs">
          {selected.length} / {max} selected
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">Local</p>
        {localModels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {localModels.map((id) => (
              <ModelChip
                key={id}
                label={id}
                selected={selected.includes(id)}
                disabled={atCap}
                onToggle={() => toggle(id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {localError
              ? `No local models (${localError}). Is your LLM server running?`
              : "Loading local models…"}
          </p>
        )}
      </div>

      {cloudGroups.map((group) => (
        <div key={group.provider} className="space-y-1.5">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">{group.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.models.map((model) => (
              <ModelChip
                key={model.id}
                label={model.label}
                selected={selected.includes(model.id)}
                disabled={atCap}
                onToggle={() => toggle(model.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {cloudGroups.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Add a cloud API key in Settings to benchmark Anthropic / OpenAI / Google models.
        </p>
      ) : null}

      {customSelected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {customSelected.map((id) => (
            <ModelChip key={id} label={id} selected disabled={false} onToggle={() => toggle(id)} />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Custom model id (e.g. openai/gpt-4.1 or a local id)"
          className="h-8 flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={addCustom} className="gap-1">
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
