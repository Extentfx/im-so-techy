import { decrypt, encrypt } from './crypto';
import type { Env } from './env';
import { isoNoMs } from './http';
import { refreshTokens, type Feature, type Provider } from './providers';

export interface ConnRow {
  id: string;
  provider: Provider;
  account: string;
  features: string;
  scopes: string;
  access_enc: string;
  refresh_enc: string | null;
  expires_at: number;
  status: 'ok' | 'needs_reconnect';
  last_error: string | null;
  mail_enabled: number;
  mail_last_checked: string | null;
  mail_last_error: string | null;
}

export const COLUMNS =
  'id, provider, account, features, scopes, access_enc, refresh_enc, expires_at, status, last_error, mail_enabled, mail_last_checked, mail_last_error';

export const featuresOf = (c: Pick<ConnRow, 'features'>): Feature[] => {
  try {
    return (JSON.parse(c.features) as Feature[]).filter((f) => f === 'mail' || f === 'calendar');
  } catch {
    return [];
  }
};

export async function loadConnection(env: Env, id: string): Promise<ConnRow | null> {
  return env.DB.prepare(`SELECT ${COLUMNS} FROM connections WHERE id = ?`)
    .bind(id)
    .first<ConnRow>();
}

async function markReconnect(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE connections SET status = 'needs_reconnect', last_error = ? WHERE id = ?",
  )
    .bind('Sign in again to keep this connected', id)
    .run();
}

/** A valid access token, refreshed when it is about to expire. If the account was revoked, flags it for reconnecting. */
export async function accessTokenFor(
  env: Env,
  f: typeof fetch,
  connectionId: string,
  now: number,
  force = false,
): Promise<string> {
  const row = await loadConnection(env, connectionId);
  if (!row) throw new Error('connection_missing');
  if (row.status === 'needs_reconnect') throw new Error('needs_reconnect');
  if (!force && row.expires_at - 60_000 > now) return decrypt(row.access_enc, env.TOKEN_KEY);
  if (!row.refresh_enc) {
    await markReconnect(env, row.id);
    throw new Error('needs_reconnect');
  }
  try {
    const t = await refreshTokens(
      env,
      f,
      row.provider,
      await decrypt(row.refresh_enc, env.TOKEN_KEY),
      now,
    );
    await env.DB.prepare(
      'UPDATE connections SET access_enc = ?, refresh_enc = ?, expires_at = ?, status = ?, last_error = NULL WHERE id = ?',
    )
      .bind(
        await encrypt(t.accessToken, env.TOKEN_KEY),
        t.refreshToken ? await encrypt(t.refreshToken, env.TOKEN_KEY) : row.refresh_enc,
        t.expiresAt,
        'ok',
        row.id,
      )
      .run();
    return t.accessToken;
  } catch (e) {
    if (e instanceof Error && e.message === 'invalid_grant') {
      await markReconnect(env, row.id);
      throw new Error('needs_reconnect');
    }
    throw e;
  }
}

/** Run `fn` with a token; if the provider says the token is bad, refresh once and retry. */
export async function withToken<T>(
  env: Env,
  f: typeof fetch,
  connectionId: string,
  now: number,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await accessTokenFor(env, f, connectionId, now));
  } catch (e) {
    if (e instanceof Error && e.message === 'unauthorized')
      return fn(await accessTokenFor(env, f, connectionId, now, true));
    throw e;
  }
}

/** Short, safe wording for an error that will be shown to the user. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (m === 'needs_reconnect' || m === 'unauthorized') return 'Sign in again on the Connect page';
  if (m === 'connection_missing') return 'This account was disconnected';
  return (m || 'Sync failed').slice(0, 200);
}

export { isoNoMs };
