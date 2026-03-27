import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const BackendConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const ConfigSchema = z.object({
  backends: z.record(z.string(), BackendConfigSchema),
  maxToolsPerSearch: z.number().int().positive().default(5),
  // Phase 2
  searchMode: z.enum(["hybrid", "fuzzy", "embedding"]).default("hybrid"),
  embeddingModel: z.string().default("Xenova/all-MiniLM-L6-v2"),
  enableSchemaCompression: z.boolean().default(true),
  enableResponseCompression: z.boolean().default(true),
  maxResponseTokens: z.number().int().positive().default(4000),
  maxArrayItems: z.number().int().positive().default(10),
  maxStringLength: z.number().int().positive().default(2000),
  stripKeyPatterns: z.array(z.string()).default(["_links", "_meta", "node_id", "*_url", "gravatar_id"]),
  removeNulls: z.boolean().default(true),
  trackUsage: z.boolean().default(true),
});

export type BackendConfig = z.infer<typeof BackendConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_DIR = path.join(os.homedir(), ".mcp-slim");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? CONFIG_FILE;

  if (!fs.existsSync(filePath)) {
    return ConfigSchema.parse({ backends: {} });
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

export function saveConfig(config: Partial<Config> & { backends: Config["backends"] }, configPath?: string): void {
  const filePath = configPath ?? CONFIG_FILE;
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}
