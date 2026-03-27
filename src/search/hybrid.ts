import { type ToolDefinition } from "../backend-manager.js";
import { fuzzySearch, type SearchResult } from "./fuzzy.js";
import { EmbeddingIndex } from "./embedding.js";

export async function hybridSearch(
  query: string,
  tools: ToolDefinition[],
  maxResults: number,
  embeddingIndex: EmbeddingIndex
): Promise<SearchResult[]> {
  // If embeddings aren't ready, fall back to fuzzy only
  if (!embeddingIndex.isReady()) {
    return fuzzySearch(query, tools, maxResults);
  }

  // Run both searches
  const fuzzyResults = fuzzySearch(query, tools, maxResults * 2);
  const embeddingResults = await embeddingIndex.search(query, maxResults * 2);

  // Normalize fuzzy scores to 0-1
  const maxFuzzy = fuzzyResults.length > 0 ? fuzzyResults[0].score : 1;
  const normalizedFuzzy = fuzzyResults.map((r) => ({
    ...r,
    score: maxFuzzy > 0 ? r.score / maxFuzzy : 0,
  }));

  // Embedding scores are already cosine similarity in 0-1
  // Merge by tool name, combine scores
  const merged = new Map<string, SearchResult>();

  for (const r of normalizedFuzzy) {
    merged.set(r.name, {
      name: r.name,
      description: r.description,
      score: 0.4 * r.score,
    });
  }

  for (const r of embeddingResults) {
    const existing = merged.get(r.name);
    if (existing) {
      existing.score += 0.6 * r.score;
    } else {
      merged.set(r.name, {
        name: r.name,
        description: r.description,
        score: 0.6 * r.score,
      });
    }
  }

  const results = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return results;
}
