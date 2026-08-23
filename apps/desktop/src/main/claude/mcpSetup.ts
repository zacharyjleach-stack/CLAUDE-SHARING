import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mcpServerEntryPath } from "../../shared/paths";

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
