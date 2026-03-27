#!/usr/bin/env node

/**
 * Phase 2 tests for mcp-slim.
 *
 * Tests schema compression, response optimization, usage tracking,
 * and (optionally) embedding search.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { compressSchema } from "../optimizer/schema.js";
import { optimizeResponse } from "../optimizer/response.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

// ── Unit tests: Schema compression ──
function testSchemaCompression(): void {
  console.log("Test A: Schema compression — redundant descriptions");
  const schema = {
    type: "object",
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "The path" },
      enabled: { type: "boolean", description: "Whether enabled", default: false },
      count: { type: "number", description: "Total count of results to return", default: 0 },
      query: { type: "string", description: "Search query to filter items by relevance" },
      name: { type: "string", description: "The name" },
    },
    required: ["path", "query"],
  };

  const compressed = compressSchema(schema);
  const comp = compressed as Record<string, unknown>;
  assert(!("$schema" in comp), "Removed $schema");
  assert(!("additionalProperties" in comp), "Removed additionalProperties");

  const props = (comp.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert(!("description" in props.path), "Stripped redundant description from 'path'");
  assert(!("description" in props.name), "Stripped redundant description from 'name'");
  assert("description" in props.query, "Kept non-redundant description on 'query'");
  assert(!("default" in props.enabled), "Removed default:false on boolean");
  assert(!("default" in props.count), "Removed default:0 on number");

  const originalSize = JSON.stringify(schema).length;
  const compressedSize = JSON.stringify(compressed).length;
  const pct = ((1 - compressedSize / originalSize) * 100).toFixed(1);
  console.log(`\n  Schema: ${originalSize} → ${compressedSize} chars (${pct}% reduction)\n`);
}

// ── Unit tests: Response optimization ──
function testResponseOptimization(): void {
  console.log("Test B: Response optimization — array truncation + stripping");
  const response = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    title: `Item ${i}`,
    body: "x".repeat(3000),
    node_id: `MDQ:${i}`,
    events_url: `https://example.com/events/${i}`,
    clone_url: `https://example.com/clone/${i}`,
    _links: { self: `https://example.com/${i}` },
    empty_field: null,
    tags: [],
    note: "",
  }));

  const optimized = optimizeResponse(response) as unknown[];
  assert(optimized.length === 11, `Array truncated to 11 items (10 + summary): got ${optimized.length}`);

  const lastItem = optimized[optimized.length - 1] as string;
  assert(typeof lastItem === "string" && lastItem.includes("40 more"), "Summary message present");

  const firstItem = optimized[0] as Record<string, unknown>;
  assert(!("node_id" in firstItem), "Stripped node_id");
  assert(!("events_url" in firstItem), "Stripped *_url fields");
  assert(!("clone_url" in firstItem), "Stripped clone_url");
  assert(!("_links" in firstItem), "Stripped _links");
  assert(!("empty_field" in firstItem), "Removed null field");
  assert(!("tags" in firstItem), "Removed empty array");
  assert(!("note" in firstItem), "Removed empty string");

  const bodyStr = firstItem.body as string;
  assert(bodyStr.length < 3000, `Body truncated: ${bodyStr.length} chars`);
  assert(bodyStr.includes("[truncated"), "Body has truncation marker");

  const originalSize = JSON.stringify(response).length;
  const optimizedSize = JSON.stringify(optimized).length;
  const pct = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
  console.log(`\n  Response: ${originalSize.toLocaleString()} → ${optimizedSize.toLocaleString()} chars (${pct}% reduction)\n`);
}

// ── Integration tests via proxy ──
async function testIntegration(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-slim-p2-test-"));
  const configPath = path.join(tmpDir, "config.json");
  const mockServerPath = path.resolve(path.join("dist", "test", "mock-server.js"));

  const config = {
    backends: {
      mock: { command: "node", args: [mockServerPath] },
    },
    maxToolsPerSearch: 5,
    searchMode: "fuzzy",  // Use fuzzy for fast deterministic tests
    enableSchemaCompression: true,
    enableResponseCompression: true,
    trackUsage: true,
  };

  fs.writeFileSync(configPath, JSON.stringify(config));
  const proxyPath = path.resolve(path.join("dist", "index.js"));

  console.log("Test C: Integration — schema compression through proxy");
  const transport = new StdioClientTransport({
    command: "node",
    args: [proxyPath, "proxy", "--config", configPath],
    stderr: "pipe",
  });

  const client = new Client(
    { name: "test-client-p2", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    // Test schema compression through proxy
    const schemaResult = await client.callTool({
      name: "get_tool_schema",
      arguments: { tool_name: "verbose_api_tool" },
    });
    const schemaContent = (schemaResult as { content: Array<{ text: string }> }).content[0].text;
    const schemaData = JSON.parse(schemaContent) as { inputSchema: { properties: Record<string, Record<string, unknown>> } };
    const props = schemaData.inputSchema.properties;

    assert(!props.path?.description, "Proxy compressed: stripped 'path' description");
    assert(!props.enabled?.description, "Proxy compressed: stripped 'enabled' description");

    // Test response optimization through proxy
    console.log("\nTest D: Integration — response optimization through proxy");
    const listResult = await client.callTool({
      name: "call_tool",
      arguments: { tool_name: "list_all_items", arguments: {} },
    });
    const listContent = (listResult as { content: Array<{ text: string }> }).content[0].text;
    const listData = JSON.parse(listContent) as unknown[];

    assert(listData.length === 11, `Response array truncated to 11: got ${listData.length}`);
    if (listData.length > 0 && typeof listData[0] === "object" && listData[0] !== null) {
      const item = listData[0] as Record<string, unknown>;
      assert(!("node_id" in item), "Response stripped node_id");
      assert(!("_links" in item), "Response stripped _links");
      assert(!("empty_field" in item), "Response removed nulls");
    }

    // Test that regular tool calls still work
    console.log("\nTest E: Integration — tool calls still work with optimizers");
    const callResult = await client.callTool({
      name: "call_tool",
      arguments: { tool_name: "github_create_issue", arguments: { repo: "test/repo", title: "Test" } },
    });
    const callContent = (callResult as { content: Array<{ text: string }> }).content[0].text;
    assert(callContent.includes("Created issue"), "Normal tool call works with optimizers enabled");

    // Test that create_memory_entity is findable by keyword
    console.log("\nTest F: Fuzzy search — create_memory_entity found by 'memory'");
    const memResult = await client.callTool({
      name: "search_tools",
      arguments: { query: "memory store knowledge" },
    });
    const memContent = (memResult as { content: Array<{ text: string }> }).content[0].text;
    const memResults = JSON.parse(memContent) as Array<{ name: string }>;
    assert(
      memResults.some((r) => r.name === "create_memory_entity"),
      "Fuzzy finds create_memory_entity by 'memory store knowledge'"
    );

  } finally {
    await transport.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Run all ──
async function main(): Promise<void> {
  console.log("MCP Slim — Phase 2 Tests\n");

  testSchemaCompression();
  testResponseOptimization();
  await testIntegration();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"═".repeat(50)}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
