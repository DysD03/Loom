import { db } from "@/db/client";
import { mcpServers } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { syncMcpServersFromFile } from "@/lib/mcp";
import { MCP_CONFIG_FILENAME } from "@/lib/mcp-config";
import { SettingsForm } from "./settings-form";
import { McpServersCard } from "./mcp-servers";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const settings = getSettings();
  let fileError: string | undefined;
  try {
    fileError = syncMcpServersFromFile().error;
  } catch {
    // ignore — show whatever is already persisted
  }
  const servers = db.select().from(mcpServers).all();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-6">
        <h1 className="text-base font-semibold">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <SettingsForm
            initial={{
              llmBaseUrl: settings.llmBaseUrl,
              llmApiKey: settings.llmApiKey,
              ollamaBaseUrl: settings.ollamaBaseUrl,
              ollamaApiKey: settings.ollamaApiKey,
              llmModel: settings.llmModel,
              utilityModel: settings.utilityModel,
              embeddingsModel: settings.embeddingsModel,
              anthropicApiKey: settings.anthropicApiKey,
              openaiApiKey: settings.openaiApiKey,
              googleApiKey: settings.googleApiKey,
              searxngUrl: settings.searxngUrl,
              tokenPricing: settings.tokenPricing,
              computeCostPerHour: settings.computeCostPerHour,
            }}
          />
          <McpServersCard
            initial={servers}
            fileError={fileError}
            configFile={MCP_CONFIG_FILENAME}
          />
        </div>
      </div>
    </div>
  );
}
