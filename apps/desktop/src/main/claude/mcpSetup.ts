import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the mcp-server's compiled entry point lives. In dev, that's the
 * sibling workspace in this source tree; in a packaged app, electron-builder
 * copies it into resources/mcp-server (see apps/desktop/package.json's
 * "build.extraResources") since the source tree won't exist on the
 * installed machine.
 */
function mcpServerEntryPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "mcp-server", "dist", "index.js");
  }
  return join(__dirname, "..", "..", "..", "..", "..", "packages", "mcp-server", "dist", "index.js");
}

/**
 * Registers the claude-sharing MCP server in the project's .mcp.json so
 * Claude Code picks it up automatically for this project, giving it tools
 * to query paired teammates' synced activity.
 */
export function ensureMcpServerRegistered(projectDir: string): void {
  const mcpJsonPath = join(projectDir, ".mcp.json");
  let config: any = { mcpServers: {} };
  if (existsSync(mcpJsonPath)) {
    try {
      config = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
    } catch {
      config = { mcpServers: {} };
    }
  }
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers["claude-sharing"] = {
    command: "node",
    args: [mcpServerEntryPath()],
  };
  writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + "\n");
}
