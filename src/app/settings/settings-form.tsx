"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { SettingsInput } from "@/lib/settings";
import type { PingResult } from "@/lib/llm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { updateSettings } from "./actions";

interface FieldProps {
  id: keyof SettingsInput;
  label: string;
  hint?: string;
  placeholder?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}

function Field({ id, label, hint, placeholder, type, value, onChange }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type ?? "text"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: SettingsInput }) {
  const [form, setForm] = useState<SettingsInput>(initial);
  const [isSaving, startSaving] = useTransition();
  const [isTesting, setIsTesting] = useState(false);

  const setField = (key: keyof SettingsInput) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    startSaving(async () => {
      try {
        await updateSettings(form);
        toast.success("Settings saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save settings");
      }
    });
  }

  async function handleTest() {
    setIsTesting(true);
    try {
      const res = await fetch("/api/llm/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: form.llmBaseUrl,
          apiKey: form.llmApiKey,
          model: form.llmModel,
        }),
      });
      const data: PingResult = await res.json();
      if (data.ok) {
        toast.success(`Connected to ${data.model || "model"}`, {
          description: data.reply ? `Reply: ${data.reply}` : undefined,
        });
      } else {
        toast.error("Connection failed", { description: data.error });
      }
    } catch (err) {
      toast.error("Connection failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Local LLM</CardTitle>
          <CardDescription>
            OpenAI-compatible endpoint. Defaults target LM Studio. To use Ollama, just
            change the base URL to{" "}
            <code className="bg-muted rounded px-1">http://localhost:11434/v1</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="llmBaseUrl"
            label="Base URL"
            placeholder="http://localhost:1234/v1"
            value={form.llmBaseUrl}
            onChange={setField("llmBaseUrl")}
          />
          <Field
            id="llmModel"
            label="Model"
            hint="The model identifier as exposed by your server (e.g. a loaded LM Studio model)."
            placeholder="qwen2.5-7b-instruct"
            value={form.llmModel}
            onChange={setField("llmModel")}
          />
          <Field
            id="embeddingsModel"
            label="Embeddings model"
            hint="Used by Memory for vector search. Can match the chat model if it supports embeddings."
            placeholder="text-embedding-nomic-embed-text-v1.5"
            value={form.embeddingsModel}
            onChange={setField("embeddingsModel")}
          />
          <Field
            id="llmApiKey"
            label="API key"
            hint="Most local servers ignore this — a dummy value is fine."
            value={form.llmApiKey}
            onChange={setField("llmApiKey")}
          />
          <Separator />
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={isTesting}>
              {isTesting ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Web search</CardTitle>
          <CardDescription>
            SearXNG instance used by the search tool and Deep Research (wired up in later
            phases).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="searxngUrl"
            label="SearXNG URL"
            placeholder="http://localhost:8080"
            value={form.searxngUrl}
            onChange={setField("searxngUrl")}
          />
          <Separator />
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
