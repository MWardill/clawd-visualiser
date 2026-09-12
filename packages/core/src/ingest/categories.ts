import type { ToolCategory } from "../schema/events";

const TABLE: Record<string, ToolCategory> = {
  Read: "read",
  Glob: "read",
  Grep: "read",
  Edit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "run",
  PowerShell: "run",
  WebFetch: "web",
  WebSearch: "web",
  Agent: "spawn",
};

/** MCP tools are reported as the single name `mcp`; the server and tool names never leave ingest. */
export function normaliseTool(name: string): string {
  return name.startsWith("mcp__") ? "mcp" : name;
}

export function categoryFor(tool: string): ToolCategory {
  return TABLE[tool] ?? "other";
}
