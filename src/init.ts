import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getConfigDir, getConfigPath, saveConfig } from "./config.js";
import { UsageTracker } from "./dashboard.js";
import { logger } from "./logger.js";

interface McpClientConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

interface ClientCandidate {
  path: string;
  label: string;
  /** Key in the JSON where mcpServers live. Default: "mcpServers" */
  serversKey?: string;
}

function getVSCodeExtensionPath(extensionId: string): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", extensionId);
  } else if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "Code", "User", "globalStorage", extensionId);
  }
  return path.join(os.homedir(), ".config", "Code", "User", "globalStorage", extensionId);
}

function getCandidatePaths(): ClientCandidate[] {
  const candidates: ClientCandidate[] = [];
  const home = os.homedir();

  // --- Claude Desktop ---
  if (process.platform === "darwin") {
    candidates.push({
      path: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      label: "Claude Desktop",
    });
  } else if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    candidates.push({
      path: path.join(appdata, "Claude", "claude_desktop_config.json"),
      label: "Claude Desktop",
    });
  } else {
    candidates.push({
      path: path.join(home, ".config", "Claude", "claude_desktop_config.json"),
      label: "Claude Desktop",
    });
  }

  // --- Claude Code ---
  candidates.push({
    path: path.join(home, ".claude", "settings.json"),
    label: "Claude Code",
  });

  // --- Cursor ---
  candidates.push({
    path: path.join(home, ".cursor", "mcp.json"),
    label: "Cursor",
  });

  // --- Windsurf (Codeium) ---
  if (process.platform === "win32") {
    candidates.push({
      path: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      label: "Windsurf",
    });
  } else {
    candidates.push({
      path: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      label: "Windsurf",
    });
  }

  // --- Cline (VS Code extension) ---
  candidates.push({
    path: path.join(getVSCodeExtensionPath("saoudrizwan.claude-dev"), "settings", "cline_mcp_settings.json"),
    label: "Cline",
  });

  // --- Roo Code (VS Code extension) ---
  candidates.push({
    path: path.join(getVSCodeExtensionPath("rooveterinaryinc.roo-cline"), "settings", "mcp_settings.json"),
    label: "Roo Code",
  });

  // --- Zed ---
  if (process.platform === "darwin") {
    candidates.push({
      path: path.join(home, ".config", "zed", "settings.json"),
      label: "Zed",
      serversKey: "context_servers",
    });
  } else if (process.platform !== "win32") {
    candidates.push({
      path: path.join(home, ".config", "zed", "settings.json"),
      label: "Zed",
      serversKey: "context_servers",
    });
  }

  // --- JetBrains IDEs ---
  // Config lives in ~/.config/JetBrains/<Product><Version>/mcp.json (Linux/Win)
  // or ~/Library/Application Support/JetBrains/<Product><Version>/mcp.json (macOS)
  const jetbrainsBase = process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "JetBrains")
    : process.platform === "win32"
      ? path.join(home, "AppData", "Roaming", "JetBrains")
      : path.join(home, ".config", "JetBrains");

  if (fs.existsSync(jetbrainsBase)) {
    try {
      const entries = fs.readdirSync(jetbrainsBase, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mcpJson = path.join(jetbrainsBase, entry.name, "mcp.json");
          if (fs.existsSync(mcpJson)) {
            candidates.push({
              path: mcpJson,
              label: `JetBrains (${entry.name})`,
            });
          }
        }
      }
    } catch {
      // JetBrains dir not readable, skip
    }
  }

  // --- Junie (JetBrains agent) ---
  candidates.push({
    path: path.join(home, ".junie", "mcp.json"),
    label: "Junie",
  });

  // --- Amazon Q ---
  candidates.push({
    path: path.join(home, ".aws", "amazonq", "mcp.json"),
    label: "Amazon Q",
  });

  return candidates;
}

function findClientConfigs(): ClientCandidate[] {
  return getCandidatePaths().filter((c) => fs.existsSync(c.path));
}

export async function runInit(): Promise<void> {
  console.log("MCP Slim — Auto-configuration\n");

  const found = findClientConfigs();
  if (found.length === 0) {
    console.log("No MCP client configurations found.");
    console.log("Supported clients: Claude Desktop, Claude Code, Cursor, Windsurf,");
    console.log("  Cline, Roo Code, Zed, JetBrains IDEs, Junie, Amazon Q");
    console.log(`\nCreate a config manually at: ${getConfigPath()}`);
    return;
  }

  console.log(`Found ${found.length} MCP client config(s):\n`);

  for (const clientConfig of found) {
    console.log(`  → ${clientConfig.label}: ${clientConfig.path}`);
    try {
      const raw = fs.readFileSync(clientConfig.path, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const serversKey = clientConfig.serversKey ?? "mcpServers";
      const servers = (parsed[serversKey] ?? {}) as Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
      const serverNames = Object.keys(servers);

      if (serverNames.length === 0) {
        console.log("    No MCP servers configured. Skipping.\n");
        continue;
      }

      // Detect if already configured — don't proxy to ourselves
      if (serverNames.length === 1 && serverNames[0] === "mcp-slim") {
        console.log("    Already configured for mcp-slim. Skipping.\n");
        continue;
      }

      // Filter out any existing mcp-slim entry before migrating
      const serversToMigrate = Object.fromEntries(
        Object.entries(servers).filter(([name]) => name !== "mcp-slim")
      );

      if (Object.keys(serversToMigrate).length === 0) {
        console.log("    No non-mcp-slim servers to migrate. Skipping.\n");
        continue;
      }

      console.log(`    Servers: ${Object.keys(serversToMigrate).join(", ")}`);

      // Back up original config
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = clientConfig.path + `.backup-${timestamp}`;
      fs.copyFileSync(clientConfig.path, backupPath);
      console.log(`    Backup: ${backupPath}`);

      // Build mcp-slim config from existing servers
      const backends: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
      for (const [name, serverDef] of Object.entries(serversToMigrate)) {
        backends[name] = {
          command: serverDef.command,
          args: serverDef.args,
          env: serverDef.env,
        };
      }

      saveConfig({ backends });
      console.log(`    MCP Slim config: ${getConfigPath()}`);

      // Rewrite client config to point to mcp-slim
      const newClientConfig = {
        ...parsed,
        [serversKey]: {
          "mcp-slim": {
            command: "npx",
            args: ["mcp-slim", "proxy"],
          },
        },
      };

      fs.writeFileSync(clientConfig.path, JSON.stringify(newClientConfig, null, 2) + "\n");
      const migratedCount = Object.keys(serversToMigrate).length;
      console.log(`    Rewrote client config to use mcp-slim proxy`);
      console.log(`    Moved ${migratedCount} server(s) to mcp-slim config\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Error processing ${clientConfig.path}: ${message}`);
    }
  }

  console.log("Done! Restart your MCP client to use mcp-slim.");
  console.log(`Config: ${getConfigPath()}`);
}

export async function runStatus(): Promise<void> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    console.log("No mcp-slim config found. Run 'mcp-slim init' first.");
    return;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as Record<string, unknown>;
  const backends = Object.entries((config.backends ?? {}) as Record<string, unknown>);

  console.log("MCP Slim — Status\n");
  console.log(`Config: ${configPath}`);
  console.log(`Backends: ${backends.length}\n`);

  for (const [name, backend] of backends) {
    const b = backend as { command: string; args?: string[] };
    console.log(`  ${name}: ${b.command} ${(b.args ?? []).join(" ")}`);
  }

  console.log(`\nSettings:`);
  console.log(`  Search mode: ${config.searchMode ?? "hybrid"}`);
  console.log(`  Schema compression: ${config.enableSchemaCompression ?? true}`);
  console.log(`  Response compression: ${config.enableResponseCompression ?? true}`);
  console.log(`  Max tools per search: ${config.maxToolsPerSearch ?? 5}`);

  // All-time usage stats
  const stats = UsageTracker.getAllTimeStats(getConfigDir());
  if (stats) {
    console.log(`\nAll-time stats:`);
    console.log(`  Sessions: ${stats.sessions}`);
    console.log(`  Total tokens saved: ~${stats.totalSaved.toLocaleString()}`);
    console.log(`  Estimated total savings: $${stats.totalCost}`);
  }
}
