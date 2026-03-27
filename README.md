# MCP Slim

**Your MCP servers eat 72% of your context window. Fix it in 60 seconds.**

Connect 3 MCP servers and 55,000 tokens are gone before your first message. That's 27% of Claude's context window. On tool definitions you'll never use.

MCP Slim sits between your client and your servers. Your AI sees 3 tools instead of 100+.

## How it works

```
search_tools("create github issue")     →  5 matches, ~200 tokens
get_tool_schema("github_create_issue")  →  just that one schema
call_tool("github_create_issue", {...}) →  routed to the right backend
```

That's it. Instead of loading every tool upfront, the LLM searches for what it needs, looks up the schema, and calls it. MCP Slim handles the routing.

```
┌─────────────┐         ┌──────────────────────┐
│  Claude /    │  stdio  │      MCP Slim        │
│  Cursor /    │◀──────▶│                      │
│  VS Code     │         │  search_tools        │
└─────────────┘         │  get_tool_schema     │
                         │  call_tool           │
                         └───┬──────┬──────┬───┘
                             │      │      │
                          GitHub  Slack  Sentry  ...
```

Zero changes to your servers. Zero changes to your client.

## Savings

| Layer | Before | After | Reduction |
|-------|--------|-------|-----------|
| Tool catalog | 20,000 tokens | 270 tokens | **98.7%** |
| Schema per lookup | 300 tokens | 180 tokens | **39%** |
| API responses | 40,000 tokens | 5,000 tokens | **87%** |

On a typical 3-tool task: **~20,000 tokens down to ~700. That's 96%+.**

## Install

```bash
npx mcp-slim init
```

Detects your existing Claude Desktop or Cursor config, backs it up, and rewrites it. Done.

> **Note:** First run downloads a ~80MB embedding model. Search works immediately
> via keyword matching; semantic search activates once the model loads (~2 seconds).

### Or configure manually

```json
// Your MCP client config
{
  "mcpServers": {
    "mcp-slim": {
      "command": "npx",
      "args": ["mcp-slim", "proxy"]
    }
  }
}
```

```json
// ~/.mcp-slim/config.json
{
  "backends": {
    "github": {
      "command": "github-mcp-server",
      "env": { "GITHUB_TOKEN": "ghp_..." }
    },
    "slack": {
      "command": "slack-mcp-server",
      "args": ["--workspace", "myteam"]
    }
  }
}
```

## What it does under the hood

- **Hybrid search** — keyword matching + local semantic embeddings (`@huggingface/transformers`). "Save a note" finds `create_memory_entity` even with zero keyword overlap.
- **Schema compression** — strips redundant descriptions, type-default values, JSON Schema meta-fields.
- **Response optimization** — truncates arrays, strips metadata keys by pattern, removes nulls.
- **Usage tracking** — per-request token savings logged to stderr, session totals persisted to SQLite. Shows estimated cost savings on shutdown.
- **Async model loading** — fuzzy search works instantly, embedding search kicks in once the model loads (~2 seconds).
- **Graceful degradation** — if embeddings fail (offline, low memory), falls back to fuzzy. Never crashes the proxy.

## CLI

```bash
mcp-slim proxy              # Start the proxy (run by MCP clients)
mcp-slim proxy --verbose    # Debug logging to stderr
mcp-slim init               # Auto-configure from existing client config
mcp-slim status             # Show backends, settings, all-time token savings
```

## Config

All optional. Defaults work out of the box.

```json
{
  "backends": {},
  "maxToolsPerSearch": 5,
  "searchMode": "hybrid",
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
  "enableSchemaCompression": true,
  "enableResponseCompression": true,
  "maxArrayItems": 10,
  "maxStringLength": 2000,
  "stripKeyPatterns": ["_links", "_meta", "node_id", "*_url"],
  "removeNulls": true,
  "trackUsage": true
}
```

## Works with

Any MCP client (Claude Desktop, Cursor, VS Code, custom agents) and any MCP server. stdio transport.

## License

MIT
