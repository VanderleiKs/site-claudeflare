import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sql, toSingleLineStatements } from './database';
import { applyMigrations } from './migrator';
import { nodeDatabase } from './node-database';

const files = [{ name: '0001_init.sql', sql: readFileSync('migrations/0001_init.sql', 'utf8') }];

describe('migrations automáticas', () => {
  it('aplica no banco vazio, registra em d1_migrations e não reaplica', async () => {
    const db = nodeDatabase(null);
    expect(await applyMigrations(db, files)).toEqual(['0001_init.sql']);
    expect(await applyMigrations(db, files)).toEqual([]);
    const rows = await db.all<{ name: string }>(sql('SELECT name FROM d1_migrations'));
    expect(rows.map((r) => r.name)).toEqual(['0001_init.sql']);
    expect(
      await db.first(
        sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'"),
      ),
    ).not.toBeNull();
  });

  it('é segura se o script já tiver sido executado (IF NOT EXISTS)', async () => {
    const db = nodeDatabase(null);
    await db.exec(files[0].sql);
    expect(await applyMigrations(db, files)).toEqual(['0001_init.sql']);
  });

  it('converte o script para um comando por linha (formato do D1 exec)', () => {
    const script = toSingleLineStatements(files[0].sql);
    const lines = script.split('\n');
    expect(lines.every((line) => line.endsWith(';') && !line.includes('--'))).toBe(true);
    expect(lines.some((line) => line.startsWith('CREATE TABLE IF NOT EXISTS products'))).toBe(true);
    // o script convertido continua válido
    const db = nodeDatabase(null);
    return expect(db.exec(script)).resolves.toBeUndefined();
  });
});
