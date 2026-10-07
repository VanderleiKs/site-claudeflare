import type { D1Database, SqlValue } from '../platform';

export type Row = Record<string, unknown>;

/** Comando SQL parametrizado (os valores nunca são concatenados na consulta). */
export interface Statement {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

export const sql = (query: string, ...params: SqlValue[]): Statement => ({ sql: query, params });

/**
 * Acesso ao banco usado pelos serviços. Em produção é o Cloudflare D1 (SQLite);
 * nos testes, o SQLite nativo do Node (ver node-database.ts). Mesma linguagem SQL.
 */
export interface Database {
  all<T = Row>(statement: Statement): Promise<T[]>;
  first<T = Row>(statement: Statement): Promise<T | null>;
  run(statement: Statement): Promise<number>;
  /** Executa os comandos de forma atômica (todos ou nenhum). */
  batch(statements: readonly Statement[]): Promise<void>;
}

/** Adaptador para a binding D1 do Cloudflare. */
export function d1Database(d1: D1Database): Database {
  const prepare = (s: Statement) => d1.prepare(s.sql).bind(...s.params);
  return {
    all: async <T>(s: Statement) => (await prepare(s).all<T>()).results,
    first: <T>(s: Statement) => prepare(s).first<T>(),
    run: async (s) => (await prepare(s).run()).meta.changes ?? 0,
    batch: async (statements) => {
      if (statements.length) await d1.batch(statements.map(prepare));
    },
  };
}

export const nowIso = () => new Date().toISOString();

/** Placeholders "?, ?, ?" para cláusulas IN. */
export const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
