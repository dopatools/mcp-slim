import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { logger } from "./logger.js";

function estimateTokens(charCount: number): number {
  return Math.round(charCount / 4);
}

interface RequestRecord {
  type: "search" | "schema" | "call";
  tool: string | null;
  backend: string | null;
  originalTokens: number;
  actualTokens: number;
  savedTokens: number;
}

export class UsageTracker {
  private requests: RequestRecord[] = [];
  private baselineTokens: number;
  private toolCount: number;
  private db: Database.Database | null = null;
  private sessionId: number | null = null;
  private startedAt: string;
  private toolsUsed = new Set<string>();

  constructor(baselineCatalogChars: number, toolCount: number, dbDir?: string) {
    this.baselineTokens = estimateTokens(baselineCatalogChars);
    this.toolCount = toolCount;
    this.startedAt = new Date().toISOString();

    if (dbDir) {
      try {
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        const dbPath = path.join(dbDir, "usage.db");
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            started_at TEXT,
            ended_at TEXT,
            request_count INTEGER,
            tools_available INTEGER,
            tools_used INTEGER,
            baseline_tokens INTEGER,
            actual_tokens INTEGER,
            saved_tokens INTEGER
          )
        `);
        // Create session row immediately
        const result = this.db.prepare(
          `INSERT INTO sessions (started_at, request_count, tools_available, tools_used, baseline_tokens, actual_tokens, saved_tokens)
           VALUES (?, 0, ?, 0, 0, 0, 0)`
        ).run(this.startedAt, this.toolCount);
        this.sessionId = Number(result.lastInsertRowid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to open usage database: ${msg}`);
      }
    }
  }

  recordSearch(query: string, resultCount: number, responseChars: number): void {
    const actualTokens = estimateTokens(responseChars);
    const record: RequestRecord = {
      type: "search",
      tool: null,
      backend: null,
      originalTokens: this.baselineTokens,
      actualTokens,
      savedTokens: this.baselineTokens - actualTokens,
    };
    this.requests.push(record);
    this.flushToDb();
  }

  recordSchemaLookup(toolName: string, originalChars: number, compressedChars: number): void {
    const originalTokens = estimateTokens(originalChars);
    const actualTokens = estimateTokens(compressedChars);
    const record: RequestRecord = {
      type: "schema",
      tool: toolName,
      backend: null,
      originalTokens,
      actualTokens,
      savedTokens: originalTokens - actualTokens,
    };
    this.requests.push(record);
    this.toolsUsed.add(toolName);
    this.flushToDb();
  }

  recordCall(toolName: string, backend: string, originalChars: number, optimizedChars: number): void {
    const originalTokens = estimateTokens(originalChars);
    const actualTokens = estimateTokens(optimizedChars);
    const saved = originalTokens - actualTokens;
    const record: RequestRecord = {
      type: "call",
      tool: toolName,
      backend,
      originalTokens,
      actualTokens,
      savedTokens: saved,
    };
    this.requests.push(record);
    this.toolsUsed.add(toolName);
    this.flushToDb();

    const pct = originalTokens > 0 ? ((saved / originalTokens) * 100).toFixed(1) : "0";
    logger.info(`[mcp-slim] ✓ ${backend} → ${toolName} | ~${saved.toLocaleString()} tokens saved (${pct}%)`);
  }

  // Issue #4: Write incrementally on every record, not just at shutdown
  private flushToDb(): void {
    if (!this.db || this.sessionId === null) return;
    try {
      const totals = this.getTotals();
      this.db.prepare(
        `UPDATE sessions SET
          request_count = ?, tools_used = ?,
          baseline_tokens = ?, actual_tokens = ?, saved_tokens = ?
        WHERE id = ?`
      ).run(
        this.requests.length, this.toolsUsed.size,
        totals.baseline, totals.actual, totals.saved,
        this.sessionId
      );
    } catch {
      // Non-critical
    }
  }

  private getTotals() {
    let baseline = 0;
    let actual = 0;
    let saved = 0;
    for (const r of this.requests) {
      baseline += r.originalTokens;
      actual += r.actualTokens;
      saved += r.savedTokens;
    }
    return { baseline, actual, saved };
  }

  finalize(): void {
    if (!this.db || this.sessionId === null) return;
    try {
      const totals = this.getTotals();
      this.db.prepare(
        `UPDATE sessions SET
          ended_at = ?, request_count = ?, tools_used = ?,
          baseline_tokens = ?, actual_tokens = ?, saved_tokens = ?
        WHERE id = ?`
      ).run(
        new Date().toISOString(), this.requests.length, this.toolsUsed.size,
        totals.baseline, totals.actual, totals.saved,
        this.sessionId
      );
    } catch {
      // Non-critical
    }
  }

  printSummary(): void {
    const totals = this.getTotals();
    const pct = totals.baseline > 0 ? ((totals.saved / totals.baseline) * 100).toFixed(1) : "0";
    const costSaved = ((totals.saved / 1_000_000) * 5).toFixed(2);

    process.stderr.write(`\n[mcp-slim] Session summary:\n`);
    process.stderr.write(`  Requests: ${this.requests.length}\n`);
    process.stderr.write(`  Tools used: ${this.toolsUsed.size} of ${this.toolCount} available\n`);
    process.stderr.write(`  Tokens saved: ~${totals.saved.toLocaleString()} (${pct}%)\n`);
    process.stderr.write(`  Estimated cost saved: $${costSaved} (at $5/1M input tokens)\n\n`);
  }

  close(): void {
    this.finalize();
    this.printSummary();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  static getAllTimeStats(dbDir: string): { sessions: number; totalSaved: number; totalCost: string } | null {
    const dbPath = path.join(dbDir, "usage.db");
    if (!fs.existsSync(dbPath)) return null;
    try {
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare(
        `SELECT COUNT(*) as sessions, COALESCE(SUM(saved_tokens), 0) as total_saved FROM sessions`
      ).get() as { sessions: number; total_saved: number };
      db.close();
      return {
        sessions: row.sessions,
        totalSaved: row.total_saved,
        totalCost: ((row.total_saved / 1_000_000) * 5).toFixed(2),
      };
    } catch {
      return null;
    }
  }
}
