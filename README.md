# MCP Slim

**Your MCP servers eat 72% of your context window. Fix it in 60 seconds.**

Connect 3 MCP servers and 55,000 tokens vanish before your first message — burned on tool definitions you'll never use. Your model gets dumber, picks wrong tools, and hallucinates more. Not because it's bad, but because its working memory is full of tool brochures.

MCP Slim is a proxy that sits between your client and your servers. Instead of dumping 100+ tool schemas upfront, it exposes 3 meta-tools. The LLM searches for what it needs, loads one schema at a time, and calls it. **One proxy, all your servers, zero config changes.**

## The trick

```
search_tools("create github issue")     →  5 matches, ~200 tokens
get_tool_schema("github_create_issue")  →  just that schema
call_tool("github_create_issue", {...}) →  routed to the right backend
```

On a typical 3-tool task: **~20,000 tokens → ~700. That's 96%.**

## Semantic search (the real feature)

Most proxies just compress descriptions or filter by name. MCP Slim runs a local embedding model so the LLM can find tools by *intent*, not keywords:

```
search_tools("save a note")  →  create_entities, add_observations
```

Zero keyword overlap. The model understood that "save a note" means "create an entity in the knowledge graph." Try that with a keyword filter.

This matters because real users don't think in tool names. They think in tasks.

## Savings

| Layer | Before | After | Reduction |
|-------|--------|-------|-----------|
| Tool catalog | 20,000 tokens | 270 tokens | **98.7%** |
| Schema per lookup | 300 tokens | 180 tokens | **39%** |
| API responses | 40,000 tokens | 5,000 tokens | **87%** |

## Install

```bash
npx mcp-slim init
```

Detects your Claude Desktop, Cursor, Cline, Windsurf, or Zed config. Backs it up. Rewrites it. Done. No Docker, no Rust toolchain, no Python virtualenv.

> First run downloads a ~80MB embedding model. Keyword search works immediately; semantic search kicks in after ~2 seconds.

### Manual setup

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

## Under the hood

- **Hybrid search** — keyword + local semantic embeddings via `@huggingface/transformers`. No API keys, fully offline.
- **Multi-server aggregation** — one proxy handles all your backends. Not one wrapper per server.
- **Schema compression** — strips redundant descriptions, default values, JSON Schema meta-fields.
- **Response optimization** — truncates arrays, strips metadata by pattern, removes nulls.
- **Usage tracking** — per-request savings to stderr, session totals to SQLite.
- **Graceful degradation** — if embeddings fail, falls back to keyword search. Never crashes.

## CLI

```bash
mcp-slim proxy              # Start the proxy
mcp-slim proxy --verbose    # With debug logging
mcp-slim init               # Auto-configure from existing client config
mcp-slim status             # Backends, settings, all-time token savings
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

## How is this different from X?

**vs mcp-compressor (Atlassian)** — compressor wraps one server at a time and has no search. You need a separate instance per backend, and the LLM must already know the tool name. MCP Slim aggregates all servers, and the LLM finds tools by describing what it wants to do.

**vs MCProxy** — MCProxy is a Rust binary with keyword search and middleware. MCP Slim adds semantic search, schema compression, response optimization, and installs with `npx` in one line.

**vs Claude Code Tool Search** — built into Claude Code only. Doesn't work in Cursor, Cline, Windsurf, Zed, or any other client. MCP Slim works everywhere.

## Works with

Claude Desktop, Claude Code, Cursor, Cline, Roo Code, Windsurf, Continue.dev, Zed, JetBrains, VS Code — any MCP client that supports stdio transport.

## License

MIT
