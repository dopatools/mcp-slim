/**
 * Response optimization — trims tool responses before
 * returning to the LLM. Never modifies what the backend returns.
 */

export interface ResponseOptimizerOptions {
  maxArrayItems: number;
  maxStringLength: number;
  stripKeyPatterns: string[];
  removeNulls: boolean;
}

const DEFAULT_OPTIONS: ResponseOptimizerOptions = {
  maxArrayItems: 10,
  maxStringLength: 2000,
  // Issue #3: Generic patterns, not GitHub-specific field names
  stripKeyPatterns: [
    "_links",
    "_meta",
    "node_id",
    "*_url",
    "gravatar_id",
  ],
  removeNulls: true,
};

export function optimizeResponse(
  response: unknown,
  options: Partial<ResponseOptimizerOptions> = {}
): unknown {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return optimizeNode(response, opts);
}

function optimizeNode(node: unknown, opts: ResponseOptimizerOptions): unknown {
  if (node === null || node === undefined) return node;

  // Transform 2: Truncate long strings
  if (typeof node === "string") {
    if (node.length > opts.maxStringLength) {
      return node.slice(0, opts.maxStringLength) + `... [truncated, ${node.length.toLocaleString()} chars total]`;
    }
    return node;
  }

  if (typeof node !== "object") return node;

  // Transform 1: Array truncation
  if (Array.isArray(node)) {
    const optimized = node.slice(0, opts.maxArrayItems).map((item) => optimizeNode(item, opts));
    if (node.length > opts.maxArrayItems) {
      optimized.push(`... and ${node.length - opts.maxArrayItems} more results (showing ${opts.maxArrayItems} of ${node.length})` as unknown);
    }
    return optimized;
  }

  // Object processing
  const obj = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Transform 4: Remove nulls/empties
    if (opts.removeNulls) {
      if (value === null || value === undefined) continue;
      if (value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
    }

    // Transform 3: Strip keys matching patterns
    if (shouldStripKey(key, opts.stripKeyPatterns)) continue;

    result[key] = optimizeNode(value, opts);
  }

  return result;
}

function shouldStripKey(key: string, patterns: string[]): boolean {
  const keyLower = key.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.startsWith("*")) {
      // Wildcard suffix match: "*_url" matches "events_url", "clone_url", etc.
      const suffix = pattern.slice(1).toLowerCase();
      if (keyLower.endsWith(suffix)) return true;
    } else {
      // Exact match
      if (keyLower === pattern.toLowerCase()) return true;
    }
  }
  return false;
}
