#!/usr/bin/env node

/**
 * Mock MCP server that exposes 25 dummy tools for testing.
 * Run this as a standalone process — the proxy connects to it via stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "mock-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Define 25 diverse dummy tools
const toolDefs: Array<{ name: string; description: string; schema: Record<string, z.ZodTypeAny>; handler: (args: Record<string, string>) => string }> = [
  { name: "github_create_issue", description: "Create a new GitHub issue in a repository", schema: { repo: z.string(), title: z.string(), body: z.string().optional() ?? z.string() }, handler: (a) => `Created issue "${a.title}" in ${a.repo}` },
  { name: "github_list_issues", description: "List issues in a GitHub repository", schema: { repo: z.string(), state: z.string().optional() ?? z.string() }, handler: (a) => `Found 12 issues in ${a.repo}` },
  { name: "github_create_pr", description: "Create a pull request on GitHub", schema: { repo: z.string(), title: z.string(), head: z.string(), base: z.string() }, handler: (a) => `Created PR "${a.title}" in ${a.repo}` },
  { name: "github_merge_pr", description: "Merge a pull request on GitHub", schema: { repo: z.string(), pr_number: z.string() }, handler: (a) => `Merged PR #${a.pr_number} in ${a.repo}` },
  { name: "github_list_repos", description: "List repositories for a user or organization", schema: { owner: z.string() }, handler: (a) => `Found 42 repos for ${a.owner}` },
  { name: "slack_send_message", description: "Send a message to a Slack channel", schema: { channel: z.string(), text: z.string() }, handler: (a) => `Sent message to #${a.channel}` },
  { name: "slack_list_channels", description: "List available Slack channels", schema: {}, handler: () => `Found 15 channels` },
  { name: "slack_read_messages", description: "Read recent messages from a Slack channel", schema: { channel: z.string(), limit: z.string().optional() ?? z.string() }, handler: (a) => `Read 10 messages from #${a.channel}` },
  { name: "sentry_list_issues", description: "List unresolved issues in Sentry", schema: { project: z.string() }, handler: (a) => `Found 8 issues in ${a.project}` },
  { name: "sentry_get_issue", description: "Get details of a specific Sentry issue", schema: { issue_id: z.string() }, handler: (a) => `Issue ${a.issue_id}: NullPointerException in auth.js` },
  { name: "sentry_resolve_issue", description: "Resolve a Sentry issue", schema: { issue_id: z.string() }, handler: (a) => `Resolved issue ${a.issue_id}` },
  { name: "jira_create_ticket", description: "Create a new Jira ticket", schema: { project: z.string(), summary: z.string(), type: z.string() }, handler: (a) => `Created ${a.type} "${a.summary}" in ${a.project}` },
  { name: "jira_list_tickets", description: "List Jira tickets with optional filters", schema: { project: z.string(), status: z.string().optional() ?? z.string() }, handler: (a) => `Found 23 tickets in ${a.project}` },
  { name: "jira_update_ticket", description: "Update a Jira ticket's status or fields", schema: { ticket_id: z.string(), status: z.string() }, handler: (a) => `Updated ${a.ticket_id} to ${a.status}` },
  { name: "notion_create_page", description: "Create a new page in Notion", schema: { parent_id: z.string(), title: z.string(), content: z.string().optional() ?? z.string() }, handler: (a) => `Created page "${a.title}"` },
  { name: "notion_search", description: "Search for pages in Notion", schema: { query: z.string() }, handler: (a) => `Found 5 pages matching "${a.query}"` },
  { name: "notion_update_page", description: "Update an existing Notion page", schema: { page_id: z.string(), content: z.string() }, handler: (a) => `Updated page ${a.page_id}` },
  { name: "grafana_query", description: "Run a Grafana query for metrics", schema: { query: z.string(), from: z.string().optional() ?? z.string(), to: z.string().optional() ?? z.string() }, handler: (a) => `Query returned 100 data points` },
  { name: "grafana_list_dashboards", description: "List available Grafana dashboards", schema: {}, handler: () => `Found 8 dashboards` },
  { name: "pagerduty_list_incidents", description: "List active PagerDuty incidents", schema: { status: z.string().optional() ?? z.string() }, handler: () => `Found 3 active incidents` },
  { name: "pagerduty_acknowledge", description: "Acknowledge a PagerDuty incident", schema: { incident_id: z.string() }, handler: (a) => `Acknowledged incident ${a.incident_id}` },
  { name: "datadog_query_metrics", description: "Query metrics from Datadog", schema: { query: z.string(), period: z.string().optional() ?? z.string() }, handler: (a) => `Metrics: avg=42.5, p99=128.3` },
  { name: "linear_create_issue", description: "Create a new Linear issue", schema: { team: z.string(), title: z.string(), description: z.string().optional() ?? z.string() }, handler: (a) => `Created issue "${a.title}" in team ${a.team}` },
  { name: "linear_list_issues", description: "List Linear issues with filters", schema: { team: z.string(), status: z.string().optional() ?? z.string() }, handler: (a) => `Found 18 issues in team ${a.team}` },
  { name: "confluence_create_page", description: "Create a new Confluence page", schema: { space: z.string(), title: z.string(), body: z.string() }, handler: (a) => `Created page "${a.title}" in space ${a.space}` },
  // Phase 2: semantic search test — no keyword overlap with "save a note"
  { name: "create_memory_entity", description: "Persist a piece of knowledge to long-term storage for later retrieval", schema: { content: z.string(), tags: z.string().optional() ?? z.string() }, handler: (a) => `Stored memory: "${a.content.slice(0, 50)}"` },
  // Phase 2: verbose schema test
  { name: "verbose_api_tool", description: "A tool with a very verbose schema for testing compression", schema: { path: z.string().describe("The path"), enabled: z.string().describe("The enabled flag"), query_string: z.string().describe("The query string parameter") }, handler: () => `OK` },
  // Phase 2: large response test
  { name: "list_all_items", description: "Returns a large JSON array for testing response optimization", schema: {}, handler: () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      title: `Item ${i + 1}`,
      body: "x".repeat(3000),
      node_id: `MDQ6SXNzdWU${i}`,
      gravatar_id: "",
      events_url: `https://api.example.com/items/${i}/events`,
      comments_url: `https://api.example.com/items/${i}/comments`,
      labels_url: `https://api.example.com/items/${i}/labels{/name}`,
      _links: { self: `https://api.example.com/items/${i}` },
      empty_field: null,
      empty_list: [],
      empty_string: "",
    }));
    return JSON.stringify(items);
  }},
];

for (const def of toolDefs) {
  server.tool(def.name, def.description, def.schema, async (args) => {
    const result = def.handler(args as Record<string, string>);
    return { content: [{ type: "text" as const, text: result }] };
  });
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Mock MCP server running with ${toolDefs.length} tools\n`);
}

main().catch((err) => {
  process.stderr.write(`Mock server error: ${err}\n`);
  process.exit(1);
});
