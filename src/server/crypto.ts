/**
 * Utilitários criptográficos com a Web Crypto API (disponível no Workers e no Node),
 * sem dependências de módulos do Node.
 */
const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Token aleatório com `bytes` bytes de entropia (base64url). */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante (não revela onde as strings diferem). */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * PBKDF2-SHA256 com 100.000 iterações — o máximo aceito pelo Web Crypto do Cloudflare Workers.
 * O número de iterações fica gravado no hash, permitindo aumentá-lo no futuro.
 * Formato: pbkdf2-sha256$iteracoes$sal$hash
 */
export const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return ['pbkdf2-sha256', PBKDF2_ITERATIONS, toBase64Url(salt), toBase64Url(hash)].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, salt, hash] = stored.split('$');
  if (algorithm !== 'pbkdf2-sha256' || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromBase64Url(salt), Number(iterations));
  return constantTimeEqual(toBase64Url(actual), hash);
}

/** Política mínima para senhas do painel. Retorna a mensagem de erro ou null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (password.length > 200) return 'A senha deve ter no máximo 200 caracteres.';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  return kinds < 3 ? 'Combine ao menos 3 tipos: minúsculas, maiúsculas, números e símbolos.' : null;
}
