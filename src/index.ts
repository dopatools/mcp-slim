#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { startProxy } from "./proxy.js";
import { runInit, runStatus } from "./init.js";
import { setLogLevel } from "./logger.js";

const program = new Command();

program
  .name("mcp-slim")
  .description("MCP proxy that reduces context window usage by 80-95%")
  .version("0.1.0");

program
  .command("proxy")
  .description("Start the MCP Slim proxy server (stdio)")
  .option("-c, --config <path>", "Path to config file")
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (opts: { config?: string; verbose?: boolean }) => {
    if (opts.verbose) {
      setLogLevel("debug");
    }
    const config = loadConfig(opts.config);
    await startProxy(config);
  });

program
  .command("init")
  .description("Auto-detect MCP client configs and set up mcp-slim as proxy")
  .action(async () => {
    await runInit();
  });

program
  .command("status")
  .description("Show configured backends and settings")
  .action(async () => {
    await runStatus();
  });

program.parse();
