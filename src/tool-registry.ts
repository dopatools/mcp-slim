import { type ToolDefinition } from "./backend-manager.js";
import { fuzzySearch, type SearchResult } from "./search/fuzzy.js";
import { EmbeddingIndex } from "./search/embedding.js";
import { hybridSearch } from "./search/hybrid.js";
import { logger } from "./logger.js";

export type SearchMode = "hybrid" | "fuzzy" | "embedding";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private toolList: ToolDefinition[] = [];
  private maxResults: number;
  private searchMode: SearchMode;
  private embeddingIndex: EmbeddingIndex;

  constructor(
    maxResults: number = 5,
    searchMode: SearchMode = "hybrid",
    embeddingModel?: string,
    embeddingCacheDir?: string
  ) {
    this.maxResults = maxResults;
    this.searchMode = searchMode;
    this.embeddingIndex = new EmbeddingIndex(embeddingModel, embeddingCacheDir);
  }

  loadTools(tools: ToolDefinition[]): void {
    this.tools.clear();
    this.toolList = [];
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        logger.warn(`Duplicate tool name "${tool.name}" — keeping first from backend "${this.tools.get(tool.name)!.backendName}"`);
        continue;
      }
      this.tools.set(tool.name, tool);
      this.toolList.push(tool);
    }
    logger.info(`Tool registry loaded: ${this.tools.size} unique tools`);

    // Start embedding loading in the background (issue #6: async model loading)
    if (this.searchMode !== "fuzzy") {
      this.embeddingIndex.init(this.toolList).catch((err) => {
        logger.warn(`Embedding init failed: ${err}`);
      });
    }
  }

  async searchTools(query: string): Promise<SearchResult[]> {
    if (this.searchMode === "fuzzy") {
      return fuzzySearch(query, this.toolList, this.maxResults);
    }
    if (this.searchMode === "embedding") {
      if (this.embeddingIndex.isReady()) {
        return this.embeddingIndex.search(query, this.maxResults);
      }
      // Fallback to fuzzy while model loads
      return fuzzySearch(query, this.toolList, this.maxResults);
    }
    // hybrid
    return hybridSearch(query, this.toolList, this.maxResults, this.embeddingIndex);
  }

  getToolSchema(toolName: string): Record<string, unknown> | null {
    const tool = this.tools.get(toolName);
    if (!tool) return null;
    return tool.inputSchema;
  }

  getToolDescription(toolName: string): string | null {
    const tool = this.tools.get(toolName);
    if (!tool) return null;
    return tool.description;
  }

  getBackendForTool(toolName: string): string | null {
    const tool = this.tools.get(toolName);
    if (!tool) return null;
    return tool.backendName;
  }

  getToolCount(): number {
    return this.tools.size;
  }

  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
