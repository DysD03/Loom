"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LayoutDashboard, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDashboardAction, loadEditorDocAction } from "@/app/dashboards/actions";

interface EditorDocSummary {
  id: string;
  title: string;
}

export function DashboardCreate({ editorDocs }: { editorDocs: EditorDocSummary[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [sourceName, setSourceName] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    const text = await file.text();
    setMarkdown(text);
    setSourceName(file.name);
    if (!title) {
      setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ""));
    }
  }

  function handlePickEditorDoc(docId: string | null) {
    if (!docId) return;
    startTransition(async () => {
      const result = await loadEditorDocAction(docId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setMarkdown(result.content);
      setSourceName(result.title);
      setTitle((current) => current || result.title);
    });
  }

  function handleGenerate() {
    startTransition(async () => {
      const result = await createDashboardAction({ title, markdown, sourceName });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.warning) {
        toast.warning(`Built without the model — ${result.warning}`);
      } else {
        toast.success("Dashboard generated.");
      }
      router.push(`/dashboards?d=${result.id}`);
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-5 px-6 py-10">
        <div className="space-y-3 text-center">
          <LayoutDashboard className="text-neon-cyan mx-auto size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
            MARKDOWN → DASHBOARD
            <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
          </p>
          <p className="text-muted-foreground text-sm">
            Paste a Markdown report, upload a .md file, or pick an Editor document. The model
            turns its numbers, tables, and lists into a live dashboard.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dashboard-title">Title (optional)</Label>
          <Input
            id="dashboard-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q3 report"
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dashboard-markdown">Markdown</Label>
          <Textarea
            id="dashboard-markdown"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={"# Q3 Report\n\n| Month | Revenue |\n|---|---|\n| Jul | $12k |\n| Aug | $18k |\n…"}
            disabled={isPending}
            className="min-h-64 font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={isPending}
            className="gap-2"
          >
            <FileUp className="size-4" />
            Upload .md
          </Button>
          {editorDocs.length > 0 ? (
            <Select value={null} onValueChange={handlePickEditorDoc} disabled={isPending}>
              <SelectTrigger className="w-56" aria-label="Load from Editor">
                <SelectValue placeholder="From Editor document…" />
              </SelectTrigger>
              <SelectContent>
                {editorDocs.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id}>
                    {doc.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="flex-1" />
          <Button onClick={handleGenerate} disabled={isPending || !markdown.trim()} className="gap-2">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {isPending ? "Generating…" : "Generate dashboard"}
          </Button>
        </div>

        {sourceName ? (
          <p className="text-muted-foreground text-xs">Source: {sourceName}</p>
        ) : null}
      </div>
    </div>
  );
}
