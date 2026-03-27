import { type ToolRegistry } from "./tool-registry.js";
import { type BackendManager } from "./backend-manager.js";
import { compressSchema } from "./optimizer/schema.js";
import { optimizeResponse, type ResponseOptimizerOptions } from "./optimizer/response.js";
import { type UsageTracker } from "./dashboard.js";
import { logger } from "./logger.js";

export interface MetaTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RouterOptions {
  enableSchemaCompression: boolean;
  enableResponseCompression: boolean;
  responseOptions?: Partial<ResponseOptimizerOptions>;
  tracker?: UsageTracker;
}

export function getMetaTools(): MetaTool[] {
  return [
    {
      name: "search_tools",
      description:
        "Search for available tools by describing what you want to do. Returns tool names and short descriptions. Always call this first before using any tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language description of what you want to do",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_tool_schema",
      description:
        "Get the full parameter schema for a specific tool. Call this after search_tools to get the exact parameters needed.",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: {
            type: "string",
            description: "Exact tool name from search_tools results",
          },
        },
        required: ["tool_name"],
      },
    },
    {
      name: "call_tool",
      description:
        "Execute a tool with the given arguments. Use the schema from get_tool_schema to construct the correct arguments.",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: {
            type: "string",
            description: "Exact tool name to call",
          },
          arguments: {
            type: "object",
            description: "Tool arguments matching the schema from get_tool_schema",
          },
        },
        required: ["tool_name", "arguments"],
      },
    },
  ];
}

export async function handleMetaTool(
  toolName: string,
  args: Record<string, unknown>,
  registry: ToolRegistry,
  backendManager: BackendManager,
  options: RouterOptions
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  switch (toolName) {
    case "search_tools": {
      const query = args.query as string;
      if (!query) {
        return {
          content: [{ type: "text", text: "Error: 'query' parameter is required" }],
          isError: true,
        };
      }
      const results = await registry.searchTools(query);
      logger.info(`search_tools("${query}") -> ${results.length} results`);

      const payload = JSON.stringify(
        results.map((r) => ({ name: r.name, description: r.description })),
        null,
        2
      );
      options.tracker?.recordSearch(query, results.length, payload.length);

      return {
        content: [{ type: "text", text: payload }],
      };
    }

    case "get_tool_schema": {
      const toolNameArg = args.tool_name as string;
      if (!toolNameArg) {
        return {
          content: [{ type: "text", text: "Error: 'tool_name' parameter is required" }],
          isError: true,
        };
      }
      const schema = registry.getToolSchema(toolNameArg);
      if (!schema) {
        return {
          content: [{ type: "text", text: `Error: Tool "${toolNameArg}" not found` }],
          isError: true,
        };
      }
      const description = registry.getToolDescription(toolNameArg);
      const outputSchema = options.enableSchemaCompression ? compressSchema(schema) : schema;
      logger.info(`get_tool_schema("${toolNameArg}")`);

      const payload = JSON.stringify({ name: toolNameArg, description, inputSchema: outputSchema }, null, 2);
      const originalPayload = JSON.stringify({ name: toolNameArg, description, inputSchema: schema }, null, 2);
      options.tracker?.recordSchemaLookup(toolNameArg, originalPayload.length, payload.length);

      return {
        content: [{ type: "text", text: payload }],
      };
    }

    case "call_tool": {
      const targetTool = args.tool_name as string;
      const toolArgs = (args.arguments ?? {}) as Record<string, unknown>;
      if (!targetTool) {
        return {
          content: [{ type: "text", text: "Error: 'tool_name' parameter is required" }],
          isError: true,
        };
      }
      const backend = registry.getBackendForTool(targetTool);
      if (!backend) {
        return {
          content: [{ type: "text", text: `Error: Tool "${targetTool}" not found` }],
          isError: true,
        };
      }
      logger.info(`call_tool("${targetTool}") -> backend "${backend}"`);
      try {
        const result = await backendManager.callTool(backend, targetTool, toolArgs);

        const mappedContent = result.content.map((c) => ({
          type: c.type,
          text: c.text ?? JSON.stringify(c),
        }));

        // Apply response optimization
        if (options.enableResponseCompression) {
          const optimized = mappedContent.map((c) => {
            if (c.type === "text" && c.text) {
              try {
                const parsed = JSON.parse(c.text);
                return { type: c.type, text: JSON.stringify(optimizeResponse(parsed, options.responseOptions)) };
              } catch {
                // Not JSON, truncate if too long
                if (c.text.length > (options.responseOptions?.maxStringLength ?? 2000)) {
                  const max = options.responseOptions?.maxStringLength ?? 2000;
                  return { type: c.type, text: c.text.slice(0, max) + `... [truncated, ${c.text.length.toLocaleString()} chars total]` };
                }
              }
            }
            return c;
          });

          const originalSize = mappedContent.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
          const optimizedSize = optimized.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
          options.tracker?.recordCall(targetTool, backend, originalSize, optimizedSize);

          return { content: optimized, isError: result.isError };
        }

        const size = mappedContent.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
        options.tracker?.recordCall(targetTool, backend, size, size);

        return { content: mappedContent, isError: result.isError };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`call_tool error: ${message}`);
        return {
          content: [{ type: "text", text: `Error calling tool "${targetTool}": ${message}` }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown meta-tool: ${toolName}` }],
        isError: true,
      };
  }
}
