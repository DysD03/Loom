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
  warning?: React.ReactNode;
  placeholder?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}

function Field({ id, label, hint, warning, placeholder, type, value, onChange }: FieldProps) {
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
      {warning ? <div className="text-xs text-amber-600 dark:text-amber-400">{warning}</div> : null}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** LM Studio / Ollama expose their OpenAI-compatible API under `/v1`. */
function missingV1(url: string): boolean {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.length > 0 && !/\/v\d+$/.test(trimmed);
}

function withV1(url: string): string {
  return `${url.trim().replace(/\/+$/, "")}/v1`;
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
            warning={
              missingV1(form.llmBaseUrl) ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  This usually ends in <code className="bg-muted rounded px-1">/v1</code> — without
                  it LM Studio/Ollama log “unexpected endpoint”.
                  <button
                    type="button"
                    onClick={() => setField("llmBaseUrl")(withV1(form.llmBaseUrl))}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Append /v1
                  </button>
                </span>
              ) : null
            }
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
          <CardTitle>Cloud providers</CardTitle>
          <CardDescription>
            Optional. Add an API key to use hosted models alongside your local one. Keys are
            stored locally in the Loom database and only sent to the matching provider. Once a
            key is set, that provider&apos;s models appear in the per-conversation model picker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="anthropicApiKey"
            label="Anthropic API key"
            type="password"
            placeholder="sk-ant-…"
            hint="Powers Claude models (Opus / Sonnet / Haiku)."
            value={form.anthropicApiKey}
            onChange={setField("anthropicApiKey")}
          />
          <Field
            id="openaiApiKey"
            label="OpenAI API key"
            type="password"
            placeholder="sk-…"
            hint="Powers GPT / o-series models."
            value={form.openaiApiKey}
            onChange={setField("openaiApiKey")}
          />
          <Field
            id="googleApiKey"
            label="Google AI API key"
            type="password"
            placeholder="AIza…"
            hint="Powers Gemini models. Get one from Google AI Studio."
            value={form.googleApiKey}
            onChange={setField("googleApiKey")}
          />
          <Separator />
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
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
