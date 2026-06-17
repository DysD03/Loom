import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";

export const OPENCODE_INSTALL_HINT =
  "opencode was not found. Install it (`npm i -g opencode-ai`, or `curl -fsSL https://opencode.ai/install | bash`), make sure it's on your PATH, and configure a model provider.";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

interface OpencodeRuntime {
  proc: ChildProcess | null;
  baseUrl: string | null;
  starting: Promise<string> | null;
  lastError: string | null;
}

// Survive Next.js hot reloads (same trick as the MCP manager).
const globalRef = globalThis as unknown as { __loomOpencode?: OpencodeRuntime };
const runtime: OpencodeRuntime =
  globalRef.__loomOpencode ??
  (globalRef.__loomOpencode = { proc: null, baseUrl: null, starting: null, lastError: null });

function findFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? res(port) : rej(new Error("could not allocate a port"))));
    });
  });
}

/** PATH augmented with common opencode install locations (Node's PATH can be minimal). */
function spawnEnv(): NodeJS.ProcessEnv {
  const extra = [
    join(homedir(), ".opencode", "bin"),
    process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const PATH = [process.env.PATH, ...extra].filter(Boolean).join(delimiter);
  return { ...process.env, PATH };
}

/**
 * Resolves the opencode executable for `spawn`. On Windows, npm installs only
 * `.cmd`/`.ps1` shims, which `spawn` cannot execute without a shell — so find
 * the real `opencode.exe`, either directly on PATH or behind the npm shim.
 */
function resolveCommand(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") {
    return "opencode";
  }
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const direct = join(dir, "opencode.exe");
    if (existsSync(direct)) return direct;
    const behindNpmShim = join(dir, "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (existsSync(behindNpmShim)) return behindNpmShim;
  }
  return "opencode"; // not found — spawn will fail and surface OPENCODE_INSTALL_HINT
}

async function waitUntilHealthy(baseUrl: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (signal.aborted) throw new Error("opencode server exited during startup.");
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      return; // any HTTP response means it's listening
    } catch {
      if (Date.now() > deadline) throw new Error("opencode server did not become ready in time.");
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

function isAlive(): boolean {
  return Boolean(runtime.proc && runtime.proc.exitCode === null && !runtime.proc.killed && runtime.baseUrl);
}

async function startServer(): Promise<string> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const env = spawnEnv();
  let proc: ChildProcess;
  try {
    proc = spawn(resolveCommand(env), ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: homedir(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(OPENCODE_INSTALL_HINT);
  }

  const exited = new AbortController();
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2_000);
  });
  proc.on("error", (err: NodeJS.ErrnoException) => {
    runtime.lastError = err.code === "ENOENT" ? OPENCODE_INSTALL_HINT : err.message;
    exited.abort();
  });
  proc.on("exit", () => {
    if (runtime.proc === proc) {
      runtime.proc = null;
      runtime.baseUrl = null;
    }
    exited.abort();
  });

  runtime.proc = proc;
  try {
    await waitUntilHealthy(baseUrl, exited.signal);
  } catch (err) {
    stop();
    throw new Error(runtime.lastError ?? stderr.trim() ?? (err instanceof Error ? err.message : String(err)));
  }

  runtime.baseUrl = baseUrl;
  runtime.lastError = null;
  return baseUrl;
}

/** Starts the managed opencode server if needed and returns its base URL. */
export async function ensureServer(): Promise<string> {
  if (isAlive() && runtime.baseUrl) return runtime.baseUrl;
  if (runtime.starting) return runtime.starting;
  runtime.starting = startServer().finally(() => {
    runtime.starting = null;
  });
  return runtime.starting;
}

export interface OpencodeStatus {
  running: boolean;
  baseUrl: string | null;
  error: string | null;
}

export function getStatus(): OpencodeStatus {
  return { running: isAlive(), baseUrl: runtime.baseUrl, error: runtime.lastError };
}

export function stop(): void {
  if (runtime.proc) {
    try {
      runtime.proc.kill();
    } catch {
      // already gone
    }
  }
  runtime.proc = null;
  runtime.baseUrl = null;
}

/** A client bound to a specific workspace folder (passed as the `directory`). */
export async function getClient(directory: string): Promise<OpencodeClient> {
  const baseUrl = await ensureServer();
  return createOpencodeClient({ baseUrl, directory, throwOnError: true });
}
