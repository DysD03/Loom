"use client";

import { useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Printer } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWidth } from "@/components/dashboards/charts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { modelLabels, type HistoryEntry } from "@/lib/benchmark-score";
import { REPORT_WIDTH } from "./report";
import {
  DEFAULT_SECTIONS,
  REPORT_SECTIONS,
  reportHref,
  type ReportSection,
} from "@/lib/report";

interface RunOption {
  id: string;
  title: string;
  suiteName: string;
  createdAt: string;
  models: string[];
}

/** Preview page box: the report's own width plus its page padding. */
const PREVIEW_PAGE = REPORT_WIDTH + 32;
const PREVIEW_HEIGHT = 900;

/** Scale that fits the fixed-width report into the available column. */
function previewScale(available: number): number {
  if (available <= 0) return 1;
  return Math.min(1, available / PREVIEW_PAGE);
}

function parseDbDate(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

const stamp = (value: string) =>
  parseDbDate(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Collapses the per-model history rows into one option per run, newest first. */
function runsFromHistory(entries: HistoryEntry[]): RunOption[] {
  const byRun = new Map<string, RunOption>();
  for (const entry of entries) {
    const existing = byRun.get(entry.runId);
    if (existing) {
      if (!existing.models.includes(entry.model)) existing.models.push(entry.model);
      continue;
    }
    byRun.set(entry.runId, {
      id: entry.runId,
      title: entry.runTitle,
      suiteName: entry.suiteName,
      createdAt: entry.createdAt,
      models: [entry.model],
    });
  }
  return [...byRun.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Export tab: choose a run, choose what the report carries, preview the exact
 * document, and print it. The preview is the report route in an iframe, so
 * "Save as PDF" prints that document — what you see is literally what is
 * exported, and none of the app chrome can leak into the page.
 */
export function BenchmarkExport({ history }: { history: HistoryEntry[] }) {
  const runs = useMemo(() => runsFromHistory(history), [history]);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [sections, setSections] = useState<ReportSection[]>(DEFAULT_SECTIONS);
  const [loading, setLoading] = useState(true);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const { ref: shell, width: shellWidth } = useWidth<HTMLDivElement>();

  if (runs.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
        <FileText className="size-6" />
        <p>
          Nothing to export yet — finish a benchmark run and it can be turned into a PDF.
        </p>
      </div>
    );
  }

  const run = runs.find((r) => r.id === runId) ?? runs[0];
  const labels = modelLabels(run.models);
  const href = reportHref(run.id, sections);
  const previewSrc = `${href}${href.includes("?") ? "&" : "?"}bare=1`;

  function toggle(key: ReportSection, on: boolean) {
    setSections((prev) => {
      const next = on ? [...prev, key] : prev.filter((k) => k !== key);
      // Never let the report become empty — the last section stays put.
      return next.length === 0 ? prev : next;
    });
  }

  /**
   * Prints the preview document itself. Falls back to opening the report in its
   * own tab if the frame is not reachable (it carries its own print button).
   */
  function print() {
    const win = frame.current?.contentWindow;
    if (!win) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    win.focus();
    win.print();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="export-run">Run</Label>
            <Select
              value={run.id}
              onValueChange={(v) => {
                if (!v) return;
                setLoading(true);
                setRunId(v);
              }}
            >
              <SelectTrigger
                id="export-run"
                className="w-full"
                aria-label="Run to export"
              >
                <SelectValue>
                  {(v: string) => runs.find((r) => r.id === v)?.title ?? "Pick a run"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {runs.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title} — {stamp(r.createdAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {run.suiteName} · {labels.join(", ")}
            </p>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-medium">Include</legend>
            {REPORT_SECTIONS.map((section) => {
              const on = sections.includes(section.key);
              return (
                <button
                  key={section.key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => {
                    setLoading(true);
                    toggle(section.key, !on);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                    on
                      ? "border-neon-cyan/50 bg-neon-cyan/5"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 inline-block size-2.5 shrink-0 rounded-sm border",
                      on ? "border-neon-cyan bg-neon-cyan" : "border-muted-foreground/50",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{section.label}</span>
                    <span className="text-muted-foreground block text-xs">
                      {section.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button onClick={print} className="gap-1.5">
              <Printer className="size-4" />
              Save as PDF
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              nativeButton={false}
              render={<a href={href} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink className="size-3.5" />
              Open report
            </Button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Opens your browser&apos;s print dialog — choose <strong>Save as PDF</strong>{" "}
            as the destination. Nothing leaves your machine; the report is rendered
            locally and printed by the browser.
          </p>
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-muted-foreground text-xs">Preview</p>
            {loading ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" />
                rendering
              </p>
            ) : null}
          </div>
          {/*
            The report is a fixed-width document, so the preview scales the whole
            page down to the column instead of letting it clip — the same trick a
            print preview uses, and it keeps the layout identical to the export.
          */}
          <div ref={shell} className="bg-muted/40 overflow-hidden rounded-lg border">
            <div
              className="relative overflow-hidden"
              style={{ height: PREVIEW_HEIGHT * previewScale(shellWidth) }}
            >
              <iframe
                ref={frame}
                key={previewSrc}
                src={previewSrc}
                title="Benchmark report preview"
                onLoad={() => setLoading(false)}
                className="border-0 bg-white"
                style={{
                  width: PREVIEW_PAGE,
                  height: PREVIEW_HEIGHT,
                  transform: `scale(${previewScale(shellWidth)})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
