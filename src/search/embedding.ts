import { type ToolDefinition } from "../backend-manager.js";
import { logger } from "../logger.js";

interface ToolEmbedding {
  toolName: string;
  description: string;
  vector: Float32Array;
}

type ExtractorPipeline = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

export class EmbeddingIndex {
  private embeddings: ToolEmbedding[] = [];
  private extractor: ExtractorPipeline | null = null;
  private ready = false;
  private loading: Promise<void> | null = null;

  constructor(
    private modelName: string = "Xenova/all-MiniLM-L6-v2",
    private cacheDir?: string
  ) {}

  async init(tools: ToolDefinition[]): Promise<void> {
    // Prevent double-init
    if (this.loading) return this.loading;
    this.loading = this.doInit(tools);
    return this.loading;
  }

  private async doInit(tools: ToolDefinition[]): Promise<void> {
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      if (this.cacheDir) {
        env.cacheDir = this.cacheDir;
      }

      logger.info(`Loading embedding model "${this.modelName}"...`);
      this.extractor = await pipeline("feature-extraction", this.modelName, {
        dtype: "fp32",
      }) as unknown as ExtractorPipeline;

      logger.info(`Generating embeddings for ${tools.length} tools...`);
      const start = Date.now();

      for (const tool of tools) {
        const text = `${tool.name} ${tool.description}`;
        const output = await this.extractor(text, { pooling: "mean", normalize: true });
        this.embeddings.push({
          toolName: tool.name,
          description: tool.description,
          vector: new Float32Array(output.data),
        });
      }

      const elapsed = Date.now() - start;
      logger.info(`Embeddings ready: ${tools.length} tools in ${elapsed}ms`);
      this.ready = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Embedding init failed, falling back to fuzzy search: ${msg}`);
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async search(query: string, maxResults: number): Promise<Array<{ name: string; description: string; score: number }>> {
    if (!this.ready || !this.extractor) {
      return [];
    }

    const output = await this.extractor(query, { pooling: "mean", normalize: true });
    const queryVec = new Float32Array(output.data);

    const scored = this.embeddings.map((e) => ({
      name: e.toolName,
      description: e.description,
      score: cosineSimilarity(queryVec, e.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
