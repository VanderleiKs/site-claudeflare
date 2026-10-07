import type { AuthUser } from '../../shared/models';
import type { ServerConfig } from '../config';
import { hashPassword, passwordProblem, randomToken, sha256, verifyPassword } from '../crypto';
import { type Database, nowIso, sql } from '../db/database';
import { HttpError } from '../http/errors';

export interface Session {
  readonly user: AuthUser;
  readonly csrfToken: string;
}

export interface NewSession extends Session {
  readonly token: string;
}

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';
const IP_WINDOW_MS = 15 * 60_000;

/**
 * Usuários do painel, sessões e proteção de login. A sessão é um token aleatório em cookie
 * HttpOnly; o banco guarda apenas o hash SHA-256 do token.
 */
export class AuthService {
  private static dummyHash?: Promise<string>;

  constructor(
    private readonly db: Database,
    private readonly config: ServerConfig,
  ) {}

  /** Limite de tentativas por IP (guardado no D1, válido para todas as instâncias do Worker). */
  async allowLoginAttempt(ip: string): Promise<boolean> {
    const now = Date.now();
    const row = await this.db.first(
      sql('SELECT count, reset_at FROM login_attempts WHERE ip = ?', ip),
    );
    if (!row || Date.parse(String(row['reset_at'])) <= now) {
      await this.db.run(
        sql(
          `INSERT INTO login_attempts (ip, count, reset_at) VALUES (?, 1, ?)
           ON CONFLICT(ip) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
          ip,
          new Date(now + IP_WINDOW_MS).toISOString(),
        ),
      );
      return true;
    }
    await this.db.run(sql('UPDATE login_attempts SET count = count + 1 WHERE ip = ?', ip));
    return Number(row['count']) + 1 <= this.config.login.maxPerIpPer15Min;
  }

  async login(emailInput: string, password: string): Promise<NewSession> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db.first(sql('SELECT * FROM users WHERE email = ?', email));

    if (!user) {
      // Equaliza o tempo de resposta para não revelar se o e-mail existe.
      AuthService.dummyHash ??= hashPassword(crypto.randomUUID());
      await verifyPassword(password, await AuthService.dummyHash);
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    const id = String(user['id']);
    const lockedUntil = user['locked_until'] ? Date.parse(String(user['locked_until'])) : 0;
    if (lockedUntil > Date.now())
      throw new HttpError(429, 'Muitas tentativas de login. Aguarde alguns minutos.');

    if (!(await verifyPassword(password, String(user['password_hash'])))) {
      const attempts = Number(user['failed_attempts']) + 1;
      const lock = attempts >= this.config.login.maxFailedAttempts;
      const until = lock
        ? new Date(Date.now() + this.config.login.lockMinutes * 60_000).toISOString()
        : null;
      await this.db.run(
        sql(
          'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
          lock ? 0 : attempts,
          until,
          id,
        ),
      );
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    await this.db.run(
      sql('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', id),
    );
    return this.createSession({ id, email: String(user['email']), name: String(user['name']) });
  }

  private async createSession(user: AuthUser): Promise<NewSession> {
    const token = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.sessionHours * 3_600_000).toISOString();
    await this.db.batch([
      sql('DELETE FROM sessions WHERE expires_at < ?', nowIso()),
      sql(
        'INSERT INTO sessions (id, token_hash, csrf_token, user_id, expires_at) VALUES (?, ?, ?, ?, ?)',
        crypto.randomUUID(),
        await sha256(token),
        csrfToken,
        user.id,
        expiresAt,
      ),
    ]);
    return { token, csrfToken, user };
  }

  async findSession(token: string | undefined): Promise<Session | null> {
    if (!token || token.length > 100) return null;
    const row = await this.db.first(
      sql(
        `SELECT s.csrf_token, s.expires_at, u.id, u.email, u.name
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?`,
        await sha256(token),
      ),
    );
    if (!row || Date.parse(String(row['expires_at'])) <= Date.now()) return null;
    return {
      csrfToken: String(row['csrf_token']),
      user: { id: String(row['id']), email: String(row['email']), name: String(row['name']) },
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token)
      await this.db.run(sql('DELETE FROM sessions WHERE token_hash = ?', await sha256(token)));
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const row = await this.db.first(sql('SELECT password_hash FROM users WHERE id = ?', userId));
    if (!row || !(await verifyPassword(current, String(row['password_hash'])))) {
      throw new HttpError(400, 'Senha atual incorreta.', [
        { field: 'currentPassword', message: 'Senha atual incorreta.' },
      ]);
    }
    const problem = passwordProblem(next);
    if (problem) throw new HttpError(400, problem, [{ field: 'newPassword', message: problem }]);
    await this.db.batch([
      sql('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), userId),
      // Encerra todas as sessões do usuário.
      sql('DELETE FROM sessions WHERE user_id = ?', userId),
    ]);
  }

  /**
   * Cria o administrador a partir de ADMIN_EMAIL/ADMIN_PASSWORD (secrets do Worker) quando ainda
   * não existe nenhum usuário, ou redefine a senha se ADMIN_RESET_PASSWORD=true.
   * Não há usuário/senha padrão no código.
   */
  async ensureAdmin(): Promise<void> {
    const { email, password, name, resetPassword } = this.config.admin;
    const count = Number((await this.db.first(sql('SELECT COUNT(*) AS n FROM users')))?.['n'] ?? 0);
    if (!email || !password) {
      if (count === 0)
        console.warn(
          '[auth] Nenhum administrador. Defina os secrets ADMIN_EMAIL e ADMIN_PASSWORD.',
        );
      return;
    }
    const problem = passwordProblem(password);
    if (problem) throw new Error(`ADMIN_PASSWORD inválida: ${problem}`);

    const existing = await this.db.first(sql('SELECT id FROM users WHERE email = ?', email));
    if (existing && resetPassword) {
      const id = String(existing['id']);
      await this.db.batch([
        sql(
          'UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?',
          await hashPassword(password),
          id,
        ),
        sql('DELETE FROM sessions WHERE user_id = ?', id),
      ]);
      console.warn(`[auth] Senha de ${email} redefinida. Remova ADMIN_RESET_PASSWORD.`);
    } else if (!existing && count === 0) {
      await this.db.run(
        sql(
          'INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
          crypto.randomUUID(),
          email,
          name,
          await hashPassword(password),
        ),
      );
      console.warn(`[auth] Administrador ${email} criado.`);
    }
  }
}
