import { type Database, sql } from './database';

export interface MigrationFile {
  /** Nome do arquivo em migrations/ (ex.: 0001_init.sql) — o mesmo registrado pelo wrangler. */
  readonly name: string;
  readonly sql: string;
}

/**
 * Aplica as migrations pendentes. Usa a mesma tabela de controle do `wrangler d1 migrations`
 * (d1_migrations), então aplicar pelo Worker ou pela linha de comando é equivalente.
 * Os arquivos usam IF NOT EXISTS, tornando seguro executar em instâncias concorrentes.
 */
export async function applyMigrations(
  db: Database,
  files: readonly MigrationFile[],
): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  );`);
  const applied = new Set(
    (await db.all<{ name: string }>(sql('SELECT name FROM d1_migrations'))).map((r) => r.name),
  );
  const executed: string[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(file.name)) continue;
    await db.exec(file.sql);
    await db.run(sql('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)', file.name));
    executed.push(file.name);
  }
  return executed;
}
