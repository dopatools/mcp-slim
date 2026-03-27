import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type BackendConfig } from "./config.js";
import { logger } from "./logger.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  backendName: string;
}

interface BackendConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: ToolDefinition[];
  available: boolean;
}

export class BackendManager {
  private backends: Map<string, BackendConnection> = new Map();
  private backendConfigs: Record<string, BackendConfig>;

  constructor(backendConfigs: Record<string, BackendConfig>) {
    this.backendConfigs = backendConfigs;
  }

  async connectAll(): Promise<void> {
    const entries = Object.entries(this.backendConfigs);
    if (entries.length === 0) {
      logger.warn("No backends configured");
      return;
    }

    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.connectBackend(name, config))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const name = entries[i][0];
      if (result.status === "rejected") {
        logger.error(`Failed to connect backend "${name}": ${result.reason}`);
      }
    }
  }

  private async connectBackend(name: string, config: BackendConfig): Promise<void> {
    logger.info(`Connecting to backend "${name}": ${config.command} ${(config.args ?? []).join(" ")}`);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
        ? { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)), ...config.env }
        : undefined,
      stderr: "pipe",
    });

    const client = new Client(
      { name: "mcp-slim", version: "0.1.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    const stderrStream = transport.stderr;
    if (stderrStream && "on" in stderrStream) {
      const readable = stderrStream as import("node:stream").Readable;
      readable.on("data", (chunk: Buffer) => {
        logger.debug(`[${name} stderr] ${chunk.toString().trim()}`);
      });
    }

    const toolsResult = await client.listTools();
    const tools: ToolDefinition[] = toolsResult.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
      backendName: name,
    }));

    logger.info(`Backend "${name}": ${tools.length} tools loaded`);

    this.backends.set(name, {
      client,
      transport,
      tools,
      available: true,
    });
  }

  getAllTools(): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    for (const backend of this.backends.values()) {
      if (backend.available) {
        allTools.push(...backend.tools);
      }
    }
    return allTools;
  }

  async callTool(
    backendName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text?: string; [key: string]: unknown }>; isError?: boolean }> {
    const backend = this.backends.get(backendName);
    if (!backend) {
      throw new Error(`Backend "${backendName}" not found`);
    }
    if (!backend.available) {
      throw new Error(`Backend "${backendName}" is unavailable`);
    }

    const result = await backend.client.callTool({ name: toolName, arguments: args });
    return result as { content: Array<{ type: string; text?: string; [key: string]: unknown }>; isError?: boolean };
  }

  getBackendNames(): string[] {
    return Array.from(this.backends.keys());
  }

  getBackendStatus(): Array<{ name: string; available: boolean; toolCount: number }> {
    const statuses: Array<{ name: string; available: boolean; toolCount: number }> = [];
    for (const [name, backend] of this.backends.entries()) {
      statuses.push({
        name,
        available: backend.available,
        toolCount: backend.tools.length,
      });
    }
    return statuses;
  }

  async shutdown(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const [name, backend] of this.backends.entries()) {
      logger.info(`Closing backend "${name}"...`);
      closePromises.push(
        backend.transport.close().catch((err) => {
          logger.error(`Error closing backend "${name}": ${err}`);
        })
      );
    }
    await Promise.allSettled(closePromises);
    this.backends.clear();
  }
}
