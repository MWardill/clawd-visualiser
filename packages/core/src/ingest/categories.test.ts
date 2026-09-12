import { describe, expect, it } from "vitest";
import { categoryFor, normaliseTool } from "./categories";

describe("tool categories", () => {
  it("maps built-in tools to the PRD categories", () => {
    expect(["Read", "Glob", "Grep"].map(categoryFor)).toEqual(["read", "read", "read"]);
    expect(["Edit", "Write", "NotebookEdit"].map(categoryFor)).toEqual(["edit", "edit", "edit"]);
    expect(["Bash", "PowerShell"].map(categoryFor)).toEqual(["run", "run"]);
    expect(["WebFetch", "WebSearch"].map(categoryFor)).toEqual(["web", "web"]);
    expect(categoryFor("Agent")).toBe("spawn");
    expect(categoryFor("AskUserQuestion")).toBe("other");
    expect(categoryFor("mcp__atlassian__getJiraIssue")).toBe("other");
  });

  it("collapses MCP tool names to mcp and leaves others alone", () => {
    expect(normaliseTool("mcp__atlassian__getJiraIssue")).toBe("mcp");
    expect(normaliseTool("Bash")).toBe("Bash");
  });

  it("does not mistake an inherited object property for a table entry", () => {
    expect(categoryFor("constructor")).toBe("other");
    expect(categoryFor("toString")).toBe("other");
  });
});
