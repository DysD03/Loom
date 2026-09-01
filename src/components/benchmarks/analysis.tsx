"use client";

import { useMemo, useState } from "react";
import { Download, Swords } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  FAILURE_HINTS,
  FAILURE_KINDS,
  FAILURE_LABELS,
  failureProfiles,
  headToHead,
  type FailureKind,
  type HeadToHeadSide,
  type HeadToHeadTask,
  type RunSummaryView,
} from "@/lib/benchmark-score";

/** Longest output snippet shown inline before the row gets unreadable. */
const SNIPPET = 160;

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card/80 min-w-0 rounded-lg border p-4">
      <div className="mb-3 space-y-1.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function FailureBadge({ kind }: { kind: FailureKind | null }) {
  if (kind === null) return null;
  return (
    <span
      className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]"
      title={FAILURE_HINTS[kind]}
    >
      {FAILURE_LABELS[kind]}
    </span>
  );
}

/** "3/5" only carries meaning once a run repeats; a single sample says nothing. */
function Split({ side }: { side: HeadToHeadSide }) {
  if (side.samples <= 1) return null;
  return (
    <span
      className="text-muted-foreground shrink-0 text-[10px]"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {side.passCount}/{side.samples}
    </span>
  );
}

/** One model's answer to one task: who, how it failed, and what it said. */
function SideLine({
  side,
  color,
  name,
}: {
  side: HeadToHeadSide;
  color: string;
  /** Shown only when the row carries both models — otherwise the card says who. */
  name?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
        {name ? <span className="text-[11px]">{name}</span> : null}
        <Split side={side} />
        <FailureBadge kind={side.failure} />
      </div>
      {side.output ? (
        <p className="text-muted-foreground pl-3 font-mono text-[11px] leading-relaxed break-words">
          {snippet(side.output)}
        </p>
      ) : null}
    </div>
  );
}

function DiffList({
  tasks,
  sides,
  empty,
}: {
  tasks: HeadToHeadTask[];
  /** The side(s) worth reading for each task — one when only one model failed. */
  sides: (
    task: HeadToHeadTask,
  ) => { side: HeadToHeadSide; color: string; name?: string }[];
  empty: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground py-3 text-xs">{empty}</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {tasks.map((task) => (
        <li key={task.index} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-xs font-medium">{task.name}</span>
            <span className="text-muted-foreground text-[10px]">{task.category}</span>
          </div>
          {sides(task).map((entry) => (
            <SideLine
              key={entry.name ?? "only"}
              side={entry.side}
              color={entry.color}
              name={entry.name}
            />
          ))}
        </li>
      ))}
    </ul>
  );
}

/** The four buckets as one bar, direct-labelled beneath — no legend to decode. */
function BucketBar({
  buckets,
}: {
  buckets: { label: string; count: number; color: string }[];
}) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      <div className="bg-muted flex h-3 w-full overflow-hidden rounded">
        {buckets.map((bucket) =>
          bucket.count === 0 ? null : (
            <div
              key={bucket.label}
              style={{
                width: `${(bucket.count / total) * 100}%`,
                background: bucket.color,
              }}
              title={`${bucket.label}: ${bucket.count}`}
            />
          ),
        )}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-sm"
              style={{ background: bucket.color }}
            />
            <dt className="text-muted-foreground">{bucket.label}</dt>
            <dd style={{ fontVariantNumeric: "tabular-nums" }}>{bucket.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Analysis: which model beats which on what, why the failures happened, and a
 * way out of the app's own opinions. A leaderboard says who won; this section
 * says what the win was made of.
 */
export function AnalysisPanel({
  runId,
  summary,
  colors,
}: {
  runId: string;
  summary: RunSummaryView;
  colors: string[];
}) {
  const models = summary.models;
  // Default the duel to the two best models — the comparison people came for.
  const ranked = useMemo(
    () => models.map((m, i) => i).sort((a, b) => models[b].score - models[a].score),
    [models],
  );
  const [aIndex, setAIndex] = useState(ranked[0] ?? 0);
  const [bIndex, setBIndex] = useState(ranked[1] ?? ranked[0] ?? 0);

  const profiles = useMemo(() => failureProfiles(summary), [summary]);
  const anyFailures = profiles.some((p) => p.failed > 0);
  const anyFlaky = profiles.some((p) => p.flaky > 0);
  const canDuel = models.length > 1 && aIndex !== bIndex;
  const duel = useMemo(
    () => (canDuel ? headToHead(summary, aIndex, bIndex) : null),
    [canDuel, summary, aIndex, bIndex],
  );

  const aColor = colors[aIndex] ?? "var(--neon-cyan)";
  const bColor = colors[bIndex] ?? "var(--neon-pink)";
  const aLabel = models[aIndex]?.label ?? "A";
  const bLabel = models[bIndex]?.label ?? "B";

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
        <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
        Analysis
        <span className="text-muted-foreground/70 ml-2 normal-case">
          (what the scores are actually made of)
        </span>
      </h2>

      <Tabs defaultValue="duel">
        <TabsList>
          <TabsTab value="duel">Head-to-head</TabsTab>
          <TabsTab value="failures">Failure kinds</TabsTab>
          <TabsTab value="raw">Raw data</TabsTab>
        </TabsList>

        <TabsPanel value="duel" className="space-y-3 pt-2">
          {models.length < 2 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Head-to-head needs two models — run this suite against a second one to
              compare.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={String(aIndex)}
                  onValueChange={(v) => v && setAIndex(Number(v))}
                >
                  <SelectTrigger size="sm" className="w-44" aria-label="First model">
                    <SelectValue>
                      {(v: string) => models[Number(v)]?.label ?? "Model"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m, i) => (
                      <SelectItem key={m.model} value={String(i)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Swords className="text-muted-foreground size-3.5" aria-hidden="true" />
                <Select
                  value={String(bIndex)}
                  onValueChange={(v) => v && setBIndex(Number(v))}
                >
                  <SelectTrigger size="sm" className="w-44" aria-label="Second model">
                    <SelectValue>
                      {(v: string) => models[Number(v)]?.label ?? "Model"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m, i) => (
                      <SelectItem key={m.model} value={String(i)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {duel === null ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  Pick two different models.
                </p>
              ) : duel.compared === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No scored task has a result from both models yet.
                </p>
              ) : (
                <>
                  <Card
                    title={`${aLabel} vs ${bLabel}`}
                    hint={`Across ${duel.compared} scored tasks. Two models on the same score can disagree on every task they get wrong — the split below is what a single percentage hides.`}
                  >
                    <BucketBar
                      buckets={[
                        {
                          label: `Only ${aLabel}`,
                          count: duel.onlyA.length,
                          color: aColor,
                        },
                        {
                          label: `Only ${bLabel}`,
                          count: duel.onlyB.length,
                          color: bColor,
                        },
                        {
                          label: "Both passed",
                          count: duel.bothPassed,
                          color: "var(--neon-green)",
                        },
                        {
                          label: "Both failed",
                          count: duel.bothFailed.length,
                          color: "var(--muted-foreground)",
                        },
                      ]}
                    />
                  </Card>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <Card
                      title={`${aLabel} won these ${duel.onlyA.length}`}
                      hint={`Passed by ${aLabel}, failed by ${bLabel} — the reply below is ${bLabel}'s.`}
                    >
                      <DiffList
                        tasks={duel.onlyA}
                        sides={(t) => [{ side: t.b, color: bColor }]}
                        empty={`${bLabel} passed everything ${aLabel} did.`}
                      />
                    </Card>
                    <Card
                      title={`${bLabel} won these ${duel.onlyB.length}`}
                      hint={`Passed by ${bLabel}, failed by ${aLabel} — the reply below is ${aLabel}'s.`}
                    >
                      <DiffList
                        tasks={duel.onlyB}
                        sides={(t) => [{ side: t.a, color: aColor }]}
                        empty={`${aLabel} passed everything ${bLabel} did.`}
                      />
                    </Card>
                  </div>

                  {duel.bothFailed.length > 0 ? (
                    <Card
                      title={`Neither passed these ${duel.bothFailed.length}`}
                      hint="Where the suite is hard for both — worth checking whether the task is fair before reading it as a model limit."
                    >
                      <DiffList
                        tasks={duel.bothFailed}
                        sides={(t) => [
                          { side: t.a, color: aColor, name: aLabel },
                          { side: t.b, color: bColor, name: bLabel },
                        ]}
                        empty=""
                      />
                    </Card>
                  ) : null}
                </>
              )}
            </>
          )}
        </TabsPanel>

        <TabsPanel value="failures" className="space-y-3 pt-2">
          {!anyFailures ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing failed — there is no taxonomy to draw.
            </p>
          ) : (
            <Card
              title="How the failures failed"
              hint="Counted over samples, not tasks. A pile of format misses is a prompt or scorer problem; a pile of wrong answers is a model one."
            >
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="py-1.5 pr-3 font-medium">Failure kind</th>
                      {profiles.map((profile, i) => (
                        <th
                          key={profile.model}
                          className="py-1.5 pl-3 text-right font-medium"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="size-2 rounded-sm"
                              style={{ background: colors[i] }}
                            />
                            {profile.label}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {FAILURE_KINDS.filter((kind) =>
                      profiles.some((p) => p.counts[kind] > 0),
                    ).map((kind) => (
                      <tr key={kind}>
                        <td className="py-1.5 pr-3">
                          <span className="text-xs" title={FAILURE_HINTS[kind]}>
                            {FAILURE_LABELS[kind]}
                          </span>
                        </td>
                        {profiles.map((profile, i) => {
                          const count = profile.counts[kind];
                          const share = profile.failed > 0 ? count / profile.failed : 0;
                          return (
                            <td key={profile.model} className="py-1.5 pl-3">
                              <div className="flex items-center justify-end gap-2">
                                <span className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{
                                      width: `${share * 100}%`,
                                      background: colors[i],
                                    }}
                                  />
                                </span>
                                <span
                                  className={cn(
                                    "w-10 text-right text-xs",
                                    count === 0 && "text-muted-foreground/50",
                                  )}
                                  style={{ fontVariantNumeric: "tabular-nums" }}
                                >
                                  {count}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="text-muted-foreground border-t text-xs">
                    <tr>
                      <td className="py-1.5 pr-3">Failed of scored samples</td>
                      {profiles.map((profile) => (
                        <td
                          key={profile.model}
                          className="py-1.5 pl-3 text-right"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {profile.failed} / {profile.samples}
                        </td>
                      ))}
                    </tr>
                    {anyFlaky ? (
                      <tr>
                        <td
                          className="py-1.5 pr-3"
                          title="Tasks it passed on some samples and failed on others."
                        >
                          Unstable tasks
                        </td>
                        {profiles.map((profile) => (
                          <td
                            key={profile.model}
                            className="py-1.5 pl-3 text-right"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {profile.flaky}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </TabsPanel>

        <TabsPanel value="raw" className="space-y-3 pt-2">
          <Card
            title="Every sample, unaggregated"
            hint="One row per model × task × repeat, with the full output, the phase split, the token counts and the failure kind. The charts here answer the questions we anticipated; this answers the ones we did not."
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-1.5"
                nativeButton={false}
                render={<a href={`/api/benchmark/${runId}/export?format=csv`} download />}
              >
                <Download className="size-3.5" />
                Download CSV
              </Button>
              <Button
                variant="outline"
                className="gap-1.5"
                nativeButton={false}
                render={
                  <a href={`/api/benchmark/${runId}/export?format=json`} download />
                }
              >
                <Download className="size-3.5" />
                Download JSON
              </Button>
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Written by your own machine and saved straight to disk — the file never
              leaves localhost.
            </p>
          </Card>
        </TabsPanel>
      </Tabs>
    </section>
  );
}
