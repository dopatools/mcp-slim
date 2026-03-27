/**
 * Schema compression — strips redundant info from tool schemas
 * before sending to the LLM. The original schema is preserved
 * for actual call forwarding.
 */

export function compressSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return compressNode(schema) as Record<string, unknown>;
}

function compressNode(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map(compressNode);
  if (typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Transform 5: Remove JSON Schema meta-fields
    if (key === "$schema" || key === "additionalProperties") continue;

    // Transform 2: Remove default values that match type defaults
    if (key === "default") {
      const type = obj["type"];
      if (
        (type === "string" && value === "") ||
        (type === "boolean" && value === false) ||
        (type === "number" && value === 0) ||
        (type === "integer" && value === 0) ||
        (type === "array" && Array.isArray(value) && value.length === 0) ||
        (type === "object" && typeof value === "object" && value !== null && Object.keys(value).length === 0)
      ) {
        continue;
      }
    }

    // Recurse into properties
    if (key === "properties" && typeof value === "object" && value !== null) {
      const props = value as Record<string, unknown>;
      const compressedProps: Record<string, unknown> = {};
      for (const [propName, propValue] of Object.entries(props)) {
        compressedProps[propName] = compressProperty(propName, propValue);
      }
      result[key] = compressedProps;
      continue;
    }

    result[key] = compressNode(value);
  }

  return result;
}

function compressProperty(propName: string, propValue: unknown): unknown {
  if (typeof propValue !== "object" || propValue === null) return propValue;
  const obj = propValue as Record<string, unknown>;
  const compressed = compressNode(obj) as Record<string, unknown>;

  // Transform 1: Strip redundant descriptions
  if (typeof compressed["description"] === "string") {
    if (isRedundantDescription(propName, compressed["description"])) {
      delete compressed["description"];
    }
  }

  // Transform 4: Trim long descriptions
  if (typeof compressed["description"] === "string" && compressed["description"].length > 100) {
    compressed["description"] = compressed["description"].slice(0, 97) + "...";
  }

  return compressed;
}

function isRedundantDescription(propName: string, description: string): boolean {
  const descLower = description.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  // Split propName on camelCase, snake_case, kebab-case
  const nameWords = propName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (nameWords.length === 0) return false;

  // If all name words appear in the description and description is short, it's redundant
  const allPresent = nameWords.every((w) => descLower.includes(w));
  const isShort = descLower.split(/\s+/).length <= nameWords.length + 3;
  return allPresent && isShort;
}
