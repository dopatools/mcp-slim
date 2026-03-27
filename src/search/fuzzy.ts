import { type ToolDefinition } from "../backend-manager.js";

export interface SearchResult {
  name: string;
  description: string;
  score: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function scoreTool(queryTokens: string[], tool: ToolDefinition): number {
  const nameLower = tool.name.toLowerCase();
  const descLower = tool.description.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    // Exact match in tool name (highest weight)
    if (nameLower === token) {
      score += 10;
    }
    // Token is a substring of tool name
    else if (nameLower.includes(token)) {
      score += 5;
    }
    // Tool name parts contain the token (split on _ and -)
    else {
      const nameParts = tokenize(tool.name);
      if (nameParts.some((p) => p === token)) {
        score += 4;
      } else if (nameParts.some((p) => p.includes(token) || token.includes(p))) {
        score += 2;
      }
    }

    // Match in description
    if (descLower.includes(token)) {
      score += 2;
    }
  }

  return score;
}

export function fuzzySearch(
  query: string,
  tools: ToolDefinition[],
  maxResults: number
): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return tools.slice(0, maxResults).map((t) => ({
      name: t.name,
      description: t.description,
      score: 0,
    }));
  }

  const scored = tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      score: scoreTool(queryTokens, tool),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored;
}
