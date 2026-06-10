"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Check, X, FileJson, AlertTriangle } from "lucide-react";

import type { McpServer, McpTransport } from "@/db/schema";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ─── Add Server Form ────────────────────────────────────────────────────────

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
};

function AddServerForm({ onAdded }: { onAdded: (server: McpServer) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof FormState) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  function handleSubmit() {
    startTransition(async () => {
      try {
        let args: string[] | undefined;
        if (form.args.trim()) {
          try {
            args = JSON.parse(form.args) as string[];
            if (!Array.isArray(args)) throw new Error();
          } catch {
            toast.error("Args must be a JSON array, e.g. [\"-y\", \"my-package\"]");
            return;
          }
        }

        let env: Record<string, string> | undefined;
        if (form.env.trim()) {
          try {
            env = JSON.parse(form.env) as Record<string, string>;
          } catch {
            toast.error("Env must be a JSON object, e.g. {\"KEY\": \"value\"}");
            return;
          }
        }

        const res = await fetch("/api/mcp/servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            transport: form.transport,
            command: form.command || undefined,
            args,
            url: form.url || undefined,
            env,
          }),
        });

        if (!res.ok) {
          const { error } = (await res.json()) as { error: string };
          toast.error(error);
          return;
        }

        const server = (await res.json()) as McpServer;
        onAdded(server);
        setForm(EMPTY_FORM);
        setOpen(false);
        toast.success(`Added MCP server: ${server.name}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add server");
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add server
      </Button>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <p className="text-sm font-medium">New MCP server</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-name">Name</Label>
          <Input
            id="mcp-name"
            placeholder="My MCP server"
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Transport</Label>
          <div className="flex gap-2">
            {(["stdio", "sse"] as McpTransport[]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={form.transport === t ? "default" : "outline"}
                onClick={() => set("transport")(t)}
                type="button"
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {form.transport === "stdio" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-command">Command</Label>
            <Input
              id="mcp-command"
              placeholder="npx"
              value={form.command}
              onChange={(e) => set("command")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-args">
              Args <span className="text-muted-foreground">(JSON array)</span>
            </Label>
            <Input
              id="mcp-args"
              placeholder='["-y", "@some/mcp-package"]'
              value={form.args}
              onChange={(e) => set("args")(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-env">
              Env vars <span className="text-muted-foreground">(JSON object, optional)</span>
            </Label>
            <Input
              id="mcp-env"
              placeholder='{"API_KEY": "..."}'
              value={form.env}
              onChange={(e) => set("env")(e.target.value)}
              spellCheck={false}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="mcp-url">SSE URL</Label>
          <Input
            id="mcp-url"
            placeholder="http://localhost:3001/sse"
            value={form.url}
            onChange={(e) => set("url")(e.target.value)}
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setForm(EMPTY_FORM);
          }}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}

// ─── Server Row ──────────────────────────────────────────────────────────────

interface ServerStatus {
  ok?: boolean;
  toolCount?: number;
  error?: string;
}

function ServerRow({
  server,
  onDelete,
  onToggle,
}: {
  server: McpServer;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const [status, setStatus] = useState<ServerStatus>({});
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const fileManaged = server.id.startsWith("file:");

  async function handleTest() {
    setIsTesting(true);
    setStatus({});
    try {
      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: server.id }),
      });
      const data = (await res.json()) as ServerStatus;
      setStatus(data);
      if (data.ok) {
        toast.success(`Connected: ${data.toolCount} tool${data.toolCount === 1 ? "" : "s"}`);
      } else {
        toast.error("Connection failed", { description: data.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStatus({ ok: false, error: msg });
      toast.error("Test failed", { description: msg });
    } finally {
      setIsTesting(false);
    }
  }

  function handleDelete() {
    if (fileManaged && !confirm(`Remove "${server.name}" from mcp.json?`)) return;
    startDelete(async () => {
      try {
        const res = await fetch(`/api/mcp/servers?id=${server.id}`, { method: "DELETE" });
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(error ?? "Failed to remove server");
          return;
        }
        onDelete();
        toast.success(
          fileManaged ? `Removed ${server.name} from mcp.json` : "MCP server removed",
        );
      } catch {
        toast.error("Failed to remove server");
      }
    });
  }

  function handleToggle() {
    startToggle(async () => {
      const enabled = !server.enabled;
      try {
        await fetch(`/api/mcp/servers?id=${server.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        onToggle(enabled);
      } catch {
        toast.error("Failed to update server");
      }
    });
  }

  const detail =
    server.transport === "stdio"
      ? [server.command, server.args ? JSON.parse(server.args).join(" ") : ""]
          .filter(Boolean)
          .join(" ")
      : server.url ?? "";

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{server.name}</span>
          <Badge variant={server.transport === "stdio" ? "secondary" : "outline"} className="text-xs">
            {server.transport}
          </Badge>
          {fileManaged && (
            <Badge variant="outline" className="flex items-center gap-1 text-xs">
              <FileJson className="size-3" />
              file
            </Badge>
          )}
          {!server.enabled && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              disabled
            </Badge>
          )}
          {status.ok === true && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <Check className="size-3" />
              {status.toolCount} tools
            </span>
          )}
          {status.ok === false && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <X className="size-3" />
              error
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTest}
          disabled={isTesting}
          title="Test connection"
        >
          <RefreshCw className={`size-3.5 ${isTesting ? "animate-spin" : ""}`} />
          {isTesting ? "Testing…" : "Test"}
        </Button>
        {!fileManaged && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            disabled={isToggling}
            title={server.enabled ? "Disable" : "Enable"}
          >
            {server.enabled ? "Disable" : "Enable"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-destructive hover:text-destructive"
          title={fileManaged ? "Remove from mcp.json" : "Remove server"}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function McpServersCard({
  initial,
  fileError,
  configFile = "mcp.json",
}: {
  initial: McpServer[];
  fileError?: string;
  configFile?: string;
}) {
  const [servers, setServers] = useState<McpServer[]>(initial);

  function handleAdded(server: McpServer) {
    setServers((s) => [...s, server]);
  }

  function handleDelete(id: string) {
    setServers((s) => s.filter((srv) => srv.id !== id));
  }

  function handleToggle(id: string, enabled: boolean) {
    setServers((s) => s.map((srv) => (srv.id === id ? { ...srv, enabled } : srv)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP Servers</CardTitle>
        <CardDescription>
          Connect Model Context Protocol servers to extend the assistant with tools. Enabled
          servers are automatically connected when a chat uses tools. You can also declare
          servers in a <code className="text-xs">{configFile}</code> file at the project root.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fileError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{fileError}</span>
          </div>
        )}
        {servers.length > 0 ? (
          <>
            <div className="divide-y">
              {servers.map((srv) => (
                <ServerRow
                  key={srv.id}
                  server={srv}
                  onDelete={() => handleDelete(srv.id)}
                  onToggle={(enabled) => handleToggle(srv.id, enabled)}
                />
              ))}
            </div>
            <Separator />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No MCP servers configured.</p>
        )}
        <AddServerForm onAdded={handleAdded} />
      </CardContent>
    </Card>
  );
}
