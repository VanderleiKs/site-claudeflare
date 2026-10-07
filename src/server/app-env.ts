import type { AuthUser } from '../shared/models';
import type { Env } from './platform';
import type { Services } from './services';

/** Tipagem do contexto Hono: bindings do Worker + variáveis por requisição. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    services: Services;
    user?: AuthUser;
  };
}
