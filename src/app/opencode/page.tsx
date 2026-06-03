import { SquareTerminal } from "lucide-react";

import { WorkspaceList } from "@/components/opencode/workspace-list";
import { OpencodeView } from "@/components/opencode/opencode-view";
import { getWorkspace, listWorkspaces } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function OpencodePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w } = await searchParams;
  const workspaces = listWorkspaces();
  const active = w ? getWorkspace(w) : undefined;

  return (
    <div className="flex h-full">
      <WorkspaceList
        workspaces={workspaces.map((ws) => ({ id: ws.id, title: ws.title, path: ws.path }))}
        activeId={active?.id}
      />
      {active ? (
        <OpencodeView key={active.id} workspaceId={active.id} title={active.title} path={active.path} />
      ) : (
        <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <SquareTerminal className="text-neon-cyan size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <div className="max-w-md space-y-3">
            <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
              OPENCODE
              <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
            </p>
            <p className="text-muted-foreground text-sm">
              Add a project folder on the left, then give the coding agent a task — it runs on your
              machine via a local opencode server. Plans from Chat, Agents, or Canvas can be sent
              here with one click.
            </p>
            <p className="text-muted-foreground/70 text-xs">
              Requires <span className="font-mono">opencode</span> installed and on your PATH, with a
              model provider configured.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
