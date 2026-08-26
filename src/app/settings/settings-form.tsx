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

/** The free-text settings; the numeric compute rate is handled separately. */
type TextSettingKey = Exclude<keyof SettingsInput, "computeCostPerHour">;

interface FieldProps {
  id: TextSettingKey;
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
  const [costPerHour, setCostPerHour] = useState(
    initial.computeCostPerHour > 0 ? String(initial.computeCostPerHour) : "",
  );
  const [isSaving, startSaving] = useTransition();
  /** Which endpoint has a test in flight, if any. */
  const [testing, setTesting] = useState<"local" | "ollama" | null>(null);

  const setField = (key: TextSettingKey) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    startSaving(async () => {
      try {
        const rate = Number(costPerHour);
        await updateSettings({
          ...form,
          computeCostPerHour: Number.isFinite(rate) && rate > 0 ? rate : 0,
        });
        toast.success("Settings saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save settings");
      }
    });
  }

  /**
   * Pings one endpoint with the values currently in the form, so a connection can
   * be verified before saving. The secondary endpoint has no model field of its
   * own — the ping picks the server's first model in that case.
   */
  async function handleTest(endpoint: "local" | "ollama") {
    const baseUrl = endpoint === "ollama" ? form.ollamaBaseUrl : form.llmBaseUrl;
    const apiKey = endpoint === "ollama" ? form.ollamaApiKey : form.llmApiKey;
    const model = endpoint === "ollama" ? "" : form.llmModel;

    if (!baseUrl.trim()) {
      toast.error("Add a base URL first");
      return;
    }

    setTesting(endpoint);
    try {
      const res = await fetch("/api/llm/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, model }),
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
      setTesting(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Local LLM — LM Studio</CardTitle>
          <CardDescription>
            Your primary OpenAI-compatible endpoint; defaults target LM Studio. Models here
            are addressed by their plain id. A second local server can be added below and
            run at the same time.
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
            id="utilityModel"
            label="Utility model"
            hint="Optional small, fast model for background tasks (memory extraction, canvas building, suggestions). Cloud models work too (e.g. anthropic/claude-haiku-4-5). Empty = use the chat model."
            placeholder="qwen2.5-3b-instruct"
            value={form.utilityModel}
            onChange={setField("utilityModel")}
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
            <Button
              variant="secondary"
              onClick={() => handleTest("local")}
              disabled={testing !== null}
            >
              {testing === "local" ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Second local server — Ollama</CardTitle>
          <CardDescription>
            Optional. Point this at a second OpenAI-compatible server and both run side by
            side: its models appear in every model picker prefixed with{" "}
            <code className="bg-muted rounded px-1">ollama/</code>, so you can chat with one,
            benchmark them against each other, or use one as the utility model. Leave the base
            URL empty to disable it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="ollamaBaseUrl"
            label="Base URL"
            placeholder="http://localhost:11434/v1"
            hint="Ollama serves its OpenAI-compatible API on port 11434. Any other compatible server works here too."
            value={form.ollamaBaseUrl}
            onChange={setField("ollamaBaseUrl")}
            warning={
              missingV1(form.ollamaBaseUrl) ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  This usually ends in <code className="bg-muted rounded px-1">/v1</code> —
                  without it the server logs “unexpected endpoint”.
                  <button
                    type="button"
                    onClick={() => setField("ollamaBaseUrl")(withV1(form.ollamaBaseUrl))}
                    className="hover:text-foreground underline underline-offset-2"
                  >
                    Append /v1
                  </button>
                </span>
              ) : null
            }
          />
          <Field
            id="ollamaApiKey"
            label="API key"
            hint="Ollama ignores this — a dummy value is fine."
            value={form.ollamaApiKey}
            onChange={setField("ollamaApiKey")}
          />
          <Separator />
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleTest("ollama")}
              disabled={testing !== null || !form.ollamaBaseUrl.trim()}
            >
              {testing === "ollama" ? "Testing…" : "Test connection"}
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
          <CardTitle>Compute cost</CardTitle>
          <CardDescription>
            Used by Benchmarks to estimate what a run costs on this machine. Entirely
            self-reported — local inference is never metered. Rule of thumb: watts ×
            $/kWh ÷ 1000, e.g. a 450&nbsp;W box at $0.30/kWh ≈ $0.14/hour (add more if you
            amortize hardware).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="computeCostPerHour">Machine cost ($ per hour)</Label>
            <Input
              id="computeCostPerHour"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.15"
              value={costPerHour}
              onChange={(e) => setCostPerHour(e.target.value)}
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              Empty or 0 hides the cost estimates on the Benchmarks tab.
            </p>
          </div>
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
