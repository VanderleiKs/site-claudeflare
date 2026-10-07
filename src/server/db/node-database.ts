import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '../platform';
import type { Database, Row, Statement } from './database';

/**
 * Implementação de `Database` com o SQLite nativo do Node — usada SOMENTE nos testes
 * automatizados (fora do Worker). Aplica as mesmas migrations do D1 (pasta migrations/);
 * passe `null` para começar com o banco vazio.
 */
export function nodeDatabase(migrationsDir: string | null = 'migrations'): Database {
  const { DatabaseSync: Sqlite } = process.getBuiltinModule('node:sqlite');
  const db: DatabaseSync = new Sqlite(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  if (migrationsDir) {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const file of files.sort()) db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  // O SQLite do Node espera BLOB como Uint8Array (o D1 aceita ArrayBuffer).
  const params = (s: Statement) =>
    s.params.map((value: SqlValue) =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    );
  return {
    all: async <T>(s: Statement) => db.prepare(s.sql).all(...params(s)) as T[],
    first: async <T>(s: Statement) =>
      (db.prepare(s.sql).get(...params(s)) as T | undefined) ?? null,
    run: async (s) => Number(db.prepare(s.sql).run(...params(s)).changes),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        for (const s of statements) db.prepare(s.sql).run(...params(s));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    exec: async (script) => {
      db.exec(script);
    },
  };
}

export type { Row };
