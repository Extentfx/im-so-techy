import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

/** Minimal D1 look-alike over node:sqlite so tests run the real migrations and SQL. */
class Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...p: unknown[]) {
    return new Stmt(this.db, this.sql, p);
  }
  async all() {
    return {
      results: this.db.prepare(this.sql).all(...(this.params as never[])),
      success: true,
      meta: {},
    };
  }
  async first() {
    return this.db.prepare(this.sql).get(...(this.params as never[])) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true, meta: { changes: r.changes } };
  }
  exec() {
    this.db.prepare(this.sql).run(...(this.params as never[]));
  }
}

export function makeD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const f of readdirSync(dir).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const db = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec('BEGIN');
      try {
        for (const s of stmts) s.exec();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
  return { db: db as unknown as D1Database, raw };
}
