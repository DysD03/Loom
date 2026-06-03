"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConversationType } from "@/db/schema";
import { CLOUD_CATALOG, type CloudProvider } from "@/lib/models";
import { setConversationModelAction } from "@/app/actions";

const DEFAULT_VALUE = "__default__";
const CUSTOM_VALUE = "__custom__";

interface ModelsResponse {
  models?: string[];
  cloudProviders?: CloudProvider[];
}

export function ModelSelect({
  conversationId,
  current,
  type = "chat",
}: {
  conversationId: string;
  current: string | null;
  type?: ConversationType;
}) {
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [isPending, startTransition] = useTransition();
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/llm/models")
      .then((res) => res.json())
      .then((data: ModelsResponse) => {
        if (!active) return;
        if (Array.isArray(data.models)) setLocalModels(data.models);
        if (Array.isArray(data.cloudProviders)) setCloudProviders(data.cloudProviders);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Human label for the trigger: prefer a curated cloud label, else the raw id.
  const labelForValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of CLOUD_CATALOG) {
      for (const entry of group.models) map.set(entry.id, entry.label);
    }
    return (value: string) => map.get(value) ?? value;
  }, []);

  const visibleCloud = CLOUD_CATALOG.filter((group) => cloudProviders.includes(group.provider));

  // Is `current` a known option, or a custom id we should surface separately?
  const knownIds = new Set<string>([
    ...localModels,
    ...CLOUD_CATALOG.flatMap((group) => group.models.map((entry) => entry.id)),
  ]);
  const customCurrent = current && !knownIds.has(current) ? current : null;

  function commit(model: string | null) {
    startTransition(() => setConversationModelAction(conversationId, model, type));
  }

  function handleChange(next: string | null) {
    if (next === CUSTOM_VALUE) {
      setCustomDraft(current ?? "");
      setCustomMode(true);
      return;
    }
    commit(!next || next === DEFAULT_VALUE ? null : next);
  }

  function saveCustom() {
    const trimmed = customDraft.trim();
    setCustomMode(false);
    commit(trimmed || null);
  }

  if (customMode) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveCustom();
            if (e.key === "Escape") setCustomMode(false);
          }}
          placeholder="e.g. anthropic/claude-opus-4-1"
          className="h-8 w-[260px]"
          autoComplete="off"
          spellCheck={false}
        />
        <Button size="sm" onClick={saveCustom} disabled={isPending}>
          Set
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCustomMode(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Select value={current ?? DEFAULT_VALUE} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger size="sm" className="w-[240px]" aria-label="Model for this conversation">
        <SelectValue placeholder="Default model">
          {current ? labelForValue(current) : "Default (from Settings)"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_VALUE}>Default (from Settings)</SelectItem>

        {customCurrent ? (
          <SelectGroup>
            <SelectSeparator />
            <SelectLabel>Custom</SelectLabel>
            <SelectItem value={customCurrent}>{customCurrent}</SelectItem>
          </SelectGroup>
        ) : null}

        {localModels.length > 0 ? (
          <SelectGroup>
            <SelectSeparator />
            <SelectLabel>Local</SelectLabel>
            {localModels.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}

        {visibleCloud.map((group) => (
          <SelectGroup key={group.provider}>
            <SelectSeparator />
            <SelectLabel>{group.label}</SelectLabel>
            {group.models.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}

        <SelectSeparator />
        <SelectItem value={CUSTOM_VALUE}>Custom model id…</SelectItem>
      </SelectContent>
    </Select>
  );
}
