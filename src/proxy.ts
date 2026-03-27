import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type Config } from "./config.js";
import { BackendManager } from "./backend-manager.js";
import { ToolRegistry } from "./tool-registry.js";
import { getMetaTools, handleMetaTool, type RouterOptions } from "./tool-router.js";
import { UsageTracker } from "./dashboard.js";
import { getConfigDir } from "./config.js";
import { logger } from "./logger.js";

export async function startProxy(config: Config): Promise<void> {
  const backends = config.backends as Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  const backendManager = new BackendManager(backends);
  const registry = new ToolRegistry(
    config.maxToolsPerSearch,
    config.searchMode as "hybrid" | "fuzzy" | "embedding",
    config.embeddingModel
  );

  // Connect to all backends
  await backendManager.connectAll();

  // Load tools into registry (also starts async embedding init)
  const allTools = backendManager.getAllTools();
  registry.loadTools(allTools);

  const totalTools = registry.getToolCount();
  logger.info(`Proxy ready: ${totalTools} tools from ${backendManager.getBackendNames().length} backends -> 3 meta-tools`);

  // Compute baseline token cost for tracking
  const baselineCatalogChars = allTools.reduce(
    (sum, t) => sum + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length,
    0
  );

  // Usage tracker
  const tracker = config.trackUsage
    ? new UsageTracker(baselineCatalogChars, totalTools, getConfigDir())
    : undefined;

  const routerOptions: RouterOptions = {
    enableSchemaCompression: config.enableSchemaCompression,
    enableResponseCompression: config.enableResponseCompression,
    responseOptions: {
      maxArrayItems: config.maxArrayItems,
      maxStringLength: config.maxStringLength,
      stripKeyPatterns: config.stripKeyPatterns as string[],
      removeNulls: config.removeNulls,
    },
    tracker,
  };

  // Create MCP server
  const server = new Server(
    { name: "mcp-slim", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tools/list -> return only 3 meta-tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const metaTools = getMetaTools();
    return {
      tools: metaTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as { type: "object"; properties?: Record<string, object>; required?: string[] },
      })),
    };
  });

  // Handle tools/call -> dispatch to meta-tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleMetaTool(
      name,
      (args ?? {}) as Record<string, unknown>,
      registry,
      backendManager,
      routerOptions
    );
    return result;
  });

  // Clean shutdown
  const cleanup = async () => {
    logger.info("Shutting down...");
    tracker?.close();
    await backendManager.shutdown();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => { void cleanup(); });
  process.on("SIGTERM", () => { void cleanup(); });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP Slim proxy running on stdio");
}
