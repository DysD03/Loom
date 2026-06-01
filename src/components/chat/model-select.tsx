"use client";

import { useEffect, useState, useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setConversationModelAction } from "@/app/actions";

const DEFAULT_VALUE = "__default__";

export function ModelSelect({
  conversationId,
  current,
}: {
  conversationId: string;
  current: string | null;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    fetch("/api/llm/models")
      .then((res) => res.json())
      .then((data: { models?: string[] }) => {
        if (active && Array.isArray(data.models)) {
          setModels(data.models);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const value = current ?? DEFAULT_VALUE;
  const options = current && !models.includes(current) ? [current, ...models] : models;

  function handleChange(next: string | null) {
    const model = !next || next === DEFAULT_VALUE ? null : next;
    startTransition(() => setConversationModelAction(conversationId, model));
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger size="sm" className="w-[220px]" aria-label="Model for this conversation">
        <SelectValue placeholder="Default model" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_VALUE}>Default (from Settings)</SelectItem>
        {options.map((model) => (
          <SelectItem key={model} value={model}>
            {model}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
