import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError, FieldError } from '../../shared/models';

/** Erro de negócio com status HTTP e, opcionalmente, erros por campo. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly errors?: readonly FieldError[];

  constructor(status: ContentfulStatusCode, message: string, errors?: readonly FieldError[]) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const notFound = (message = 'Registro não encontrado.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const badRequest = (message: string, errors?: readonly FieldError[]) =>
  new HttpError(400, message, errors);

/** Converte qualquer erro em JSON padronizado, sem expor detalhes internos. */
export function errorResponse(error: unknown, c: Context): Response {
  if (error instanceof HttpError) {
    const body: ApiError = { status: error.status, message: error.message, errors: error.errors };
    return c.json(body, error.status, { 'Cache-Control': 'no-store' });
  }
  console.error(`[api] ${c.req.method} ${c.req.path}`, error);
  const body: ApiError = { status: 500, message: 'Erro interno. Tente novamente em instantes.' };
  return c.json(body, 500, { 'Cache-Control': 'no-store' });
}
