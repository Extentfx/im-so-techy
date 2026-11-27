/**
 * Connected accounts: Google and Microsoft sign-in (OAuth with PKCE), the Connect page's data,
 * automatic email checks, and picking which of an account's calendars to import.
 *
 * Rules enforced here:
 *  - Each sign-in has a single-use, ten-minute `state` and a PKCE verifier kept on the server.
 *  - Tokens are AES-GCM encrypted and never returned by any route.
 *  - Mail is read-only. Messages are read, run through the same tool-less reader as pasted email,
 *    and only a redacted summary plus pending proposals are kept.
 */
import type { CalendarSource } from '@life/shared';
import { encrypt } from './crypto';
import { ingestMessage } from './email';
import { notify } from './admin';
import {
  audit,
  err,
  getSetting,
  isoNoMs,
  json,
  newId,
  readJson,
  setSetting,
  str,
  type Ctx,
  type Handler,
} from './http';
import { loadProfile } from './foundation';
import { hasClaude } from './anthropic';
import {
  accountEmail,
  buildAuthUrl,
  creds,
  exchangeCode,
  FEATURES,
  fetchRecentMail,
  listCalendars,
  PROVIDERS,
  revokeToken,
  type Feature,
  type Provider,
} from './providers';
import { syncSource } from './sync';
import {
  COLUMNS,
  featuresOf,
  friendlyError,
  loadConnection,
  withToken,
  type ConnRow,
} from './tokens';
import { decrypt } from './crypto';

const STATE_TTL = 10 * 60_000;
const MAX_MAIL_PER_RUN = 15;
const MAX_PENDING_EMAIL_PROPOSALS = 15;
const MAX_SOURCES = 10;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randomToken = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const challengeOf = async (v: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));

const baseUrl = (c: Pick<Ctx, 'env' | 'url'>) =>
  c.env.PUBLIC_URL?.replace(/\/+$/, '') || c.url.origin;
const redirectUri = (c: Pick<Ctx, 'env' | 'url'>, p: Provider) =>
  `${baseUrl(c)}/api/oauth/callback/${p}`;
const LABEL: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft' };
const HOST: Record<Provider, string> = { google: 'google.com', microsoft: 'outlook.com' };

const toConnection = (r: ConnRow) => ({
  id: r.id,
  provider: r.provider,
  account: r.account,
  features: featuresOf(r),
  status: r.status,
  error: r.last_error,
  mailEnabled: r.mail_enabled === 1,
  mailLastChecked: r.mail_last_checked,
  mailError: r.mail_last_error,
});

/* ------------------------------ automatic email ------------------------------ */

export interface MailRun {
  processed: number;
  proposals: number;
}

export async function runMailCheck(
  c: Pick<Ctx, 'env' | 'now' | 'fetchImpl'>,
  row: ConnRow,
): Promise<MailRun> {
  const { env } = c;
  const now = c.now();
  try {
    if (!featuresOf(row).includes('mail'))
      throw new Error('Email access was not granted for this account');
    const seen = new Set(
      (
        (
          await env.DB.prepare('SELECT message_id FROM email_seen WHERE connection_id = ?')
            .bind(row.id)
            .all<{ message_id: string }>()
        ).results ?? []
      ).map((r) => r.message_id),
    );
    // First run looks back two days only, so connecting never floods you with old mail.
    const sinceMs = row.mail_last_checked
      ? Math.max(Date.parse(row.mail_last_checked) - 3_600_000, now - 7 * 86_400_000)
      : now - 2 * 86_400_000;
    const msgs = await withToken(env, c.fetchImpl, row.id, now, (token) =>
      fetchRecentMail(c.fetchImpl, row.provider, token, {
        nowMs: now,
        sinceMs,
        max: MAX_MAIL_PER_RUN,
        skip: seen,
      }),
    );
    const run: MailRun = { processed: 0, proposals: 0 };
    for (const m of msgs) {
      // Mark as seen first, so a message that fails once is never retried forever.
      await env.DB.prepare(
        'INSERT OR IGNORE INTO email_seen (connection_id, message_id, seen_at) VALUES (?,?,?)',
      )
        .bind(row.id, m.id, now)
        .run();
      if (!m.body.trim()) continue;
      try {
        const r = await ingestMessage(
          c,
          { from: m.from, subject: m.subject, body: m.body },
          { maxPendingProposals: MAX_PENDING_EMAIL_PROPOSALS },
        );
        run.processed++;
        run.proposals += r.proposals;
      } catch {
        /* one unreadable message must not stop the rest */
      }
    }
    await env.DB.prepare(
      'UPDATE connections SET mail_last_checked = ?, mail_last_error = NULL WHERE id = ?',
    )
      .bind(isoNoMs(now), row.id)
      .run();
    await env.DB.prepare('DELETE FROM email_seen WHERE seen_at < ?')
      .bind(now - 30 * 86_400_000)
      .run();
    if (run.proposals > 0)
      await notify(
        env,
        c.fetchImpl,
        'New events found in your email',
        `${run.proposals} suggested event${run.proposals > 1 ? 's' : ''} are waiting for your tap.`,
      ).catch(() => false);
    return run;
  } catch (e) {
    await env.DB.prepare(
      'UPDATE connections SET mail_last_error = ?, mail_last_checked = ? WHERE id = ?',
    )
      .bind(friendlyError(e), isoNoMs(now), row.id)
      .run();
    throw e;
  }
}

/** The cron job: check every connected inbox that is switched on. One failing account never blocks the others. */
export async function runMailChecks(c: Pick<Ctx, 'env' | 'now' | 'fetchImpl'>): Promise<number> {
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS} FROM connections WHERE mail_enabled = 1 AND status = 'ok'`,
  ).all<ConnRow>();
  let n = 0;
  for (const row of results ?? []) {
    try {
      n += (await runMailCheck(c, row)).processed;
    } catch {
      /* recorded on the connection */
    }
  }
  return n;
}

/* --------------------------------- routes --------------------------------- */

const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);

export const connections: Handler = async (c) => {
  const { env, path, method, req } = c;

  if (path === '/api/connectors' && method === 'GET') {
    const ics =
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM calendar_sources WHERE type = 'ics'",
        ).first<{ n: number }>()
      )?.n ?? 0;
    return json({
      providers: PROVIDERS.map((p) => ({
        provider: p,
        label: LABEL[p],
        configured: !!creds(env, p),
        redirectUri: redirectUri(c, p),
      })),
      server: {
        claude: hasClaude(env),
        usdaKey: !!env.FDC_API_KEY,
        backups: !!env.BACKUPS,
        serviceToken: !!env.ALLOWED_SERVICE_TOKENS,
      },
      calendarLinks: ics,
      home: !!(await getSetting(env, 'ha')),
      notifications: !!(await getSetting(env, 'ntfy')),
    });
  }

  if (path === '/api/oauth/start' && method === 'POST') {
    const b = await readJson(req);
    const provider = b?.provider;
    const features = Array.isArray(b?.features)
      ? FEATURES.filter((f) => (b!.features as unknown[]).includes(f))
      : [];
    if (!isProvider(provider) || !features.length)
      return err(400, 'provider_and_features_required');
    if (!creds(env, provider)) return err(409, 'provider_not_configured');
    await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(c.now()).run();
    const state = randomToken(32);
    const verifier = randomToken(48);
    await env.DB.prepare(
      'INSERT INTO oauth_states (state, provider, verifier, features, expires_at) VALUES (?,?,?,?,?)',
    )
      .bind(state, provider, verifier, JSON.stringify(features), c.now() + STATE_TTL)
      .run();
    return json({
      url: buildAuthUrl(env, provider, {
        redirectUri: redirectUri(c, provider),
        state,
        challenge: await challengeOf(verifier),
        features,
      }),
    });
  }

  const cb = /^\/api\/oauth\/callback\/(google|microsoft)$/.exec(path);
  if (cb && method === 'GET') {
    const provider = cb[1] as Provider;
    const back = (q: string) =>
      new Response(null, {
        status: 302,
        headers: {
          location: `${baseUrl(c)}/?${q}`,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        },
      });
    const state = c.url.searchParams.get('state') ?? '';
    const code = c.url.searchParams.get('code') ?? '';
    if (!/^[\w-]{20,100}$/.test(state)) return back('connect_error=invalid_state');
    const row = await env.DB.prepare(
      'SELECT provider, verifier, features, expires_at FROM oauth_states WHERE state = ?',
    )
      .bind(state)
      .first<{ provider: string; verifier: string; features: string; expires_at: number }>();
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run(); // single use, whatever happens next
    if (!row || row.provider !== provider || row.expires_at < c.now())
      return back('connect_error=invalid_state');
    if (c.url.searchParams.get('error') || !code) return back('connect_error=denied');
    try {
      const t = await exchangeCode(
        env,
        c.fetchImpl,
        provider,
        code,
        redirectUri(c, provider),
        row.verifier,
        c.now(),
      );
      const account = await accountEmail(c.fetchImpl, provider, t.accessToken);
      const features = JSON.parse(row.features) as Feature[];
      const existing = await env.DB.prepare(
        'SELECT id, refresh_enc FROM connections WHERE provider = ? AND account = ?',
      )
        .bind(provider, account)
        .first<{ id: string; refresh_enc: string | null }>();
      if (!t.refreshToken && !existing?.refresh_enc) return back('connect_error=no_refresh_token');
      const access = await encrypt(t.accessToken, env.TOKEN_KEY);
      const refresh = t.refreshToken
        ? await encrypt(t.refreshToken, env.TOKEN_KEY)
        : existing!.refresh_enc;
      if (existing) {
        await env.DB.prepare(
          "UPDATE connections SET features = ?, scopes = ?, access_enc = ?, refresh_enc = ?, expires_at = ?, status = 'ok', last_error = NULL, mail_enabled = ? WHERE id = ?",
        )
          .bind(
            JSON.stringify(features),
            t.scope.slice(0, 1000),
            access,
            refresh,
            t.expiresAt,
            features.includes('mail') ? 1 : 0,
            existing.id,
          )
          .run();
      } else {
        await env.DB.prepare(
          'INSERT INTO connections (id, provider, account, features, scopes, access_enc, refresh_enc, expires_at, mail_enabled) VALUES (?,?,?,?,?,?,?,?,?)',
        )
          .bind(
            newId(),
            provider,
            account,
            JSON.stringify(features),
            t.scope.slice(0, 1000),
            access,
            refresh,
            t.expiresAt,
            features.includes('mail') ? 1 : 0,
          )
          .run();
      }
      await audit(
        env,
        'user',
        'connection.add',
        `${provider}:${account}`,
        `features: ${features.join(', ')}`,
      );
      return back(`connected=${provider}`);
    } catch {
      return back('connect_error=failed'); // details are deliberately not passed to the page
    }
  }

  if (path === '/api/connections' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT ${COLUMNS} FROM connections ORDER BY created_at`,
    ).all<ConnRow>();
    return json({
      connections: (results ?? []).map(toConnection),
      mirror: (await getSetting<{ connectionId: string }>(env, 'mirror'))?.connectionId ?? null,
    });
  }

  const m = /^\/api\/connections\/([0-9a-f-]{36})(?:\/(mail\/check|mail|calendars|mirror))?$/.exec(
    path,
  );
  if (!m) return null;
  const row = await loadConnection(env, m[1]!);
  if (!row) return err(404, 'not_found');
  const sub = m[2];

  if (!sub && method === 'DELETE') {
    try {
      const token = await decrypt(row.access_enc, env.TOKEN_KEY);
      await revokeToken(env, c.fetchImpl, row.provider, token);
    } catch {
      /* revoking is best effort; the rows go either way */
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM calendar_sources WHERE connection_id = ?').bind(row.id), // events and alerts cascade
      env.DB.prepare('DELETE FROM connections WHERE id = ?').bind(row.id),
    ]);
    const mirror = await getSetting<{ connectionId: string }>(env, 'mirror');
    if (mirror?.connectionId === row.id)
      await env.DB.prepare("DELETE FROM settings WHERE key IN ('mirror','mirror_calendar')").run();
    await audit(env, 'user', 'connection.remove', `${row.provider}:${row.account}`, 'ok');
    return json({ ok: true });
  }

  if (sub === 'mail' && method === 'POST') {
    const b = await readJson(req);
    if (typeof b?.enabled !== 'boolean') return err(400, 'enabled_required');
    if (b.enabled && !featuresOf(row).includes('mail')) return err(400, 'email_access_not_granted');
    await env.DB.prepare('UPDATE connections SET mail_enabled = ? WHERE id = ?')
      .bind(b.enabled ? 1 : 0, row.id)
      .run();
    await audit(
      env,
      'user',
      'mail.autocheck',
      `${row.provider}:${row.account}`,
      b.enabled ? 'on' : 'off',
    );
    return json({ ok: true });
  }

  if (sub === 'mail/check' && method === 'POST') {
    try {
      return json(await runMailCheck(c, row));
    } catch (e) {
      return err(502, friendlyError(e));
    }
  }

  if (sub === 'calendars' && method === 'GET') {
    if (!featuresOf(row).includes('calendar')) return err(400, 'calendar_access_not_granted');
    try {
      const remote = await withToken(env, c.fetchImpl, row.id, c.now(), (t) =>
        listCalendars(c.fetchImpl, row.provider, t),
      );
      const added = new Set(
        (
          (
            await env.DB.prepare('SELECT remote_id FROM calendar_sources WHERE connection_id = ?')
              .bind(row.id)
              .all<{ remote_id: string }>()
          ).results ?? []
        ).map((r) => r.remote_id),
      );
      return json({ calendars: remote.map((r) => ({ ...r, added: added.has(r.id) })) });
    } catch (e) {
      return err(502, friendlyError(e));
    }
  }

  if (sub === 'calendars' && method === 'POST') {
    if (!featuresOf(row).includes('calendar')) return err(400, 'calendar_access_not_granted');
    const b = await readJson(req);
    const kind = b?.kind === 'work' || b?.kind === 'school' || b?.kind === 'family' ? b.kind : null;
    const remoteId = typeof b?.remoteId === 'string' ? b.remoteId : '';
    if (!kind || !remoteId) return err(400, 'kind_and_remoteId_required');
    const count =
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_sources').first<{ n: number }>())
        ?.n ?? 0;
    if (count >= MAX_SOURCES) return err(400, 'too_many_sources');
    let remote;
    try {
      remote = (
        await withToken(env, c.fetchImpl, row.id, c.now(), (t) =>
          listCalendars(c.fetchImpl, row.provider, t),
        )
      ).find((x) => x.id === remoteId);
    } catch (e) {
      return err(502, friendlyError(e));
    }
    if (!remote) return err(400, 'calendar_not_found'); // only calendars this account really has
    if (
      await env.DB.prepare(
        'SELECT 1 AS x FROM calendar_sources WHERE connection_id = ? AND remote_id = ?',
      )
        .bind(row.id, remoteId)
        .first()
    )
      return err(409, 'already_added');
    const id = newId();
    const name = str(b?.name, 60) ?? remote.name;
    await env.DB.prepare(
      'INSERT INTO calendar_sources (id, name, kind, type, host, connection_id, remote_id) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(id, name, kind, row.provider, HOST[row.provider], row.id, remoteId)
      .run();
    await audit(env, 'user', 'source.add', `${kind}:${name}@${row.provider}`, 'ok');
    const src = {
      id,
      name,
      kind,
      url_enc: null,
      host: HOST[row.provider],
      last_synced_at: null,
      type: row.provider,
      connection_id: row.id,
      remote_id: remoteId,
    } as const;
    let error: string | undefined;
    try {
      await syncSource(env, { ...src }, c.now(), c.getFeed, c.fetchImpl);
    } catch (e) {
      error = friendlyError(e);
    }
    const fresh = await env.DB.prepare(
      'SELECT id, name, kind, type, host, last_synced_at, last_error FROM calendar_sources WHERE id = ?',
    )
      .bind(id)
      .first<{
        id: string;
        name: string;
        kind: CalendarSource['kind'];
        type: CalendarSource['type'];
        host: string;
        last_synced_at: string | null;
        last_error: string | null;
      }>();
    return json(
      {
        source: {
          id: fresh!.id,
          name: fresh!.name,
          kind: fresh!.kind,
          type: fresh!.type,
          host: fresh!.host,
          lastSyncedAt: fresh!.last_synced_at,
          lastError: fresh!.last_error,
        },
        error,
      },
      201,
    );
  }

  if (sub === 'mirror' && method === 'POST') {
    const b = await readJson(req);
    if (typeof b?.enabled !== 'boolean') return err(400, 'enabled_required');
    if (b.enabled) {
      if (row.provider !== 'google' || !featuresOf(row).includes('calendar'))
        return err(400, 'needs_google_calendar_access');
      await setSetting(env, 'mirror', { connectionId: row.id });
    } else await env.DB.prepare("DELETE FROM settings WHERE key = 'mirror'").run();
    await audit(
      env,
      'user',
      'calendar.mirror.setting',
      `${row.provider}:${row.account}`,
      b.enabled ? 'on' : 'off',
    );
    return json({ ok: true });
  }

  void loadProfile;
  return null;
};
