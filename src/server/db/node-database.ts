import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '../platform';
import type { Database, Row, Statement } from './database';

/**
 * Implementação de `Database` com o SQLite nativo do Node — usada SOMENTE nos testes
 * automatizados (fora do Worker). Aplica as mesmas migrations do D1 (pasta migrations/).
 */
export function nodeDatabase(migrationsDir = 'migrations'): Database {
  const { DatabaseSync: Sqlite } = process.getBuiltinModule('node:sqlite');
  const db: DatabaseSync = new Sqlite(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  const params = (s: Statement) => s.params as SqlValue[];
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
  };
}

export type { Row };
