#!/usr/bin/env node

/**
 * Integration tests for mcp-slim.
 *
 * Starts the proxy with a mock backend, connects as an MCP client,
 * and verifies the 3 meta-tool pattern works correctly.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

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

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

async function runTests(): Promise<void> {
  console.log("MCP Slim — Integration Tests\n");

  // Create a temporary config that points to our mock server
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-slim-test-"));
  const configPath = path.join(tmpDir, "config.json");
  const mockServerPath = path.resolve(path.join("dist", "test", "mock-server.js"));

  const config = {
    backends: {
      mock: {
        command: "node",
        args: [mockServerPath],
      },
    },
    maxToolsPerSearch: 5,
    enableResponseCompression: true,
    maxResponseTokens: 4000,
  };

  fs.writeFileSync(configPath, JSON.stringify(config));

  // Start the proxy as a child process
  const proxyPath = path.resolve(path.join("dist", "index.js"));

  console.log("Starting proxy with mock backend...\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [proxyPath, "proxy", "--config", configPath],
    stderr: "pipe",
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    // ── Test 1: tools/list returns exactly 3 meta-tools ──
    console.log("Test 1: tools/list returns only 3 meta-tools");
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();
    assertEq(toolsResult.tools.length, 3, "Exactly 3 tools returned");
    assert(toolNames.includes("search_tools"), "Has search_tools");
    assert(toolNames.includes("get_tool_schema"), "Has get_tool_schema");
    assert(toolNames.includes("call_tool"), "Has call_tool");

    // Calculate token savings
    const metaToolTokens = JSON.stringify(toolsResult.tools).length / 4; // rough estimate
    // 25 tools × ~800 tokens each
    const fullCatalogTokens = 25 * 800;
    const savings = ((fullCatalogTokens - metaToolTokens) / fullCatalogTokens * 100).toFixed(1);
    console.log(`\n  Token estimate: ${Math.round(metaToolTokens)} tokens (meta) vs ~${fullCatalogTokens} tokens (full) = ${savings}% savings\n`);

    // ── Test 2: search_tools returns relevant results ──
    console.log("Test 2: search_tools returns relevant results");
    const searchResult = await client.callTool({
      name: "search_tools",
      arguments: { query: "create github issue" },
    });
    const searchContent = (searchResult as { content: Array<{ text: string }> }).content[0].text;
    const searchResults = JSON.parse(searchContent) as Array<{ name: string; description: string }>;
    assert(searchResults.length > 0, `Found ${searchResults.length} results`);
    assert(
      searchResults.some((r) => r.name === "github_create_issue"),
      "Top results include github_create_issue"
    );

    // ── Test 3: search for slack tools ──
    console.log("\nTest 3: search for slack tools");
    const slackResult = await client.callTool({
      name: "search_tools",
      arguments: { query: "send slack message" },
    });
    const slackContent = (slackResult as { content: Array<{ text: string }> }).content[0].text;
    const slackResults = JSON.parse(slackContent) as Array<{ name: string }>;
    assert(slackResults.length > 0, `Found ${slackResults.length} Slack-related results`);
    assert(
      slackResults.some((r) => r.name === "slack_send_message"),
      "Results include slack_send_message"
    );

    // ── Test 4: get_tool_schema returns full schema ──
    console.log("\nTest 4: get_tool_schema returns full schema");
    const schemaResult = await client.callTool({
      name: "get_tool_schema",
      arguments: { tool_name: "github_create_issue" },
    });
    const schemaContent = (schemaResult as { content: Array<{ text: string }> }).content[0].text;
    const schemaData = JSON.parse(schemaContent) as { name: string; inputSchema: { properties: Record<string, unknown> } };
    assertEq(schemaData.name, "github_create_issue", "Schema has correct tool name");
    assert(
      schemaData.inputSchema && typeof schemaData.inputSchema === "object",
      "Schema has inputSchema"
    );
    assert(
      "properties" in schemaData.inputSchema,
      "inputSchema has properties"
    );

    // ── Test 5: get_tool_schema for non-existent tool returns error ──
    console.log("\nTest 5: get_tool_schema for unknown tool returns error");
    const badSchemaResult = await client.callTool({
      name: "get_tool_schema",
      arguments: { tool_name: "nonexistent_tool" },
    });
    const badSchemaContent = (badSchemaResult as { content: Array<{ text: string }> }).content[0].text;
    assert(badSchemaContent.includes("not found"), "Error message mentions tool not found");

    // ── Test 6: call_tool forwards and returns results ──
    console.log("\nTest 6: call_tool forwards to backend and returns result");
    const callResult = await client.callTool({
      name: "call_tool",
      arguments: {
        tool_name: "github_create_issue",
        arguments: { repo: "test/repo", title: "Test Issue", body: "This is a test" },
      },
    });
    const callContent = (callResult as { content: Array<{ text: string }> }).content[0].text;
    assert(callContent.includes("Created issue"), "Result contains expected output");
    assert(callContent.includes("Test Issue"), "Result contains issue title");

    // ── Test 7: call_tool for another tool ──
    console.log("\nTest 7: call_tool for slack_send_message");
    const slackCallResult = await client.callTool({
      name: "call_tool",
      arguments: {
        tool_name: "slack_send_message",
        arguments: { channel: "general", text: "Hello world" },
      },
    });
    const slackCallContent = (slackCallResult as { content: Array<{ text: string }> }).content[0].text;
    assert(slackCallContent.includes("Sent message"), "Slack message sent successfully");

    // ── Test 8: call_tool for non-existent tool returns error ──
    console.log("\nTest 8: call_tool for unknown tool returns error");
    const badCallResult = await client.callTool({
      name: "call_tool",
      arguments: { tool_name: "nonexistent_tool", arguments: {} },
    });
    const badCallContent = (badCallResult as { content: Array<{ text: string }> }).content[0].text;
    assert(badCallContent.includes("not found"), "Error for unknown tool");

    // ── Test 9: search with empty/broad query ──
    console.log("\nTest 9: search for 'list' returns multiple tools");
    const listResult = await client.callTool({
      name: "search_tools",
      arguments: { query: "list" },
    });
    const listContent = (listResult as { content: Array<{ text: string }> }).content[0].text;
    const listResults = JSON.parse(listContent) as Array<{ name: string }>;
    assert(listResults.length >= 3, `Broad search returned ${listResults.length} results (expected ≥3)`);

    // ── Test 10: search for monitoring tools ──
    console.log("\nTest 10: search for monitoring/metrics tools");
    const monResult = await client.callTool({
      name: "search_tools",
      arguments: { query: "metrics query monitoring" },
    });
    const monContent = (monResult as { content: Array<{ text: string }> }).content[0].text;
    const monResults = JSON.parse(monContent) as Array<{ name: string }>;
    assert(monResults.length > 0, `Found ${monResults.length} monitoring tools`);
    const monNames = monResults.map((r) => r.name);
    assert(
      monNames.some((n) => n.includes("grafana") || n.includes("datadog")),
      "Results include monitoring tools"
    );

  } finally {
    await transport.close();
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Summary
  console.log(`\n${"═".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"═".repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
