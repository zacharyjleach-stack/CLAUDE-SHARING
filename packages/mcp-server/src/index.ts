#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPeerActivity, listPeers, searchPeerTranscript } from "./store.js";

const server = new McpServer({
  name: "claude-sharing",
  version: "0.2.0",
});

server.registerTool(
  "list_teammates",
  {
    description:
      "List teammates currently paired with this machine's claude-sharing desktop app, with when they were last seen active.",
    inputSchema: {},
  },
  async () => {
    const peers = listPeers();
    return {
      content: [{ type: "text", text: JSON.stringify(peers, null, 2) }],
    };
  }
);

server.registerTool(
  "get_teammate_activity",
  {
    description:
      "Get a teammate's recent activity (file edits, bash commands, commits, messages) synced in real time from their Claude Code session. Use this to answer questions like 'what has <name> just added/changed'.",
    inputSchema: {
      name: z.string().describe("Teammate's name, as shown by list_teammates."),
      since: z
        .string()
        .optional()
        .describe("ISO timestamp; only return events at or after this time."),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Max number of recent events to return (default 50)."),
    },
  },
  async ({ name, since, limit }) => {
    const events = getPeerActivity(name, { since, limit });
    if (events.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No synced activity found for "${name}". Either they're not paired right now, or nothing has happened yet.`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
    };
  }
);

server.registerTool(
  "search_teammate_transcript",
  {
    description:
      "Full-text search a teammate's synced Claude Code transcript (their full conversation, tool calls, and results) for a keyword or phrase.",
    inputSchema: {
      name: z.string().describe("Teammate's name, as shown by list_teammates."),
      query: z.string().describe("Text to search for (case-insensitive substring match)."),
      limit: z.number().int().positive().max(100).optional(),
    },
  },
  async ({ name, query, limit }) => {
    const matches = searchPeerTranscript(name, query, limit ?? 20);
    return {
      content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
