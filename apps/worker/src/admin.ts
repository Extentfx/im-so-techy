/**
 * Data ownership: export, encrypted backup and restore, the kill switch, phone notifications,
 * and the optional read-only family link.
 */
import { localDateKey, addDaysKey, atLocal } from '@life/shared';
import { decrypt, encrypt } from './crypto';
import type { Env } from './env';
import {
  audit,
  DATE,
  err,
  getSetting,
  isoNoMs,
  json,
  readJson,
  setSetting,
  type Ctx,
  type Handler,
} from './http';
import { loadProfile } from './foundation';
import { suggestionFor } from './bedtime';

/* ------------------------------- tables ------------------------------- */

/** Parents first: restore inserts in this order and deletes in reverse. Events are re-synced, not backed up. */
export const BACKUP_TABLES = [
  'settings',
  'calendar_sources',
  'dashboard_events',
  'proposals',
  'audit_log',
  'templates',
  'workouts',
  'sets',
  'bodyweight',
  'foods',
  'meals',
  'food_log',
  'lunch_rules',
  'lunch_status',
  'sleep_log',
  'email_digest',
  'devices',
  'scenes',
  'chat_usage',
] as const;
type Table = (typeof BACKUP_TABLES)[number];

/** Columns that hold encrypted secrets. They go into encrypted backups but never into plain exports. */
const SECRET_COLUMNS: Partial<Record<Table, string[]>> = { calendar_sources: ['url_enc'] };
const SECRET_SETTING_KEYS = new Set(['ha', 'ntfy']);

type Row = Record<string, unknown>;

async function columns(env: Env, table: Table): Promise<string[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

export async function dumpAll(
  env: Env,
  opts: { secrets: boolean },
): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const t of BACKUP_TABLES) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all<Row>();
    let rows = results ?? [];
    if (!opts.secrets) {
      const secret = SECRET_COLUMNS[t] ?? [];
      rows = rows.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => !secret.includes(k))),
      );
      if (t === 'settings')
        rows = rows.filter(
          (r) => !SECRET_SETTING_KEYS.has(String(r.key)) && !String(r.key).startsWith('routine:'),
        );
    }
    out[t] = rows;
  }
  return out;
}

const backupKey = (env: Env) => env.BACKUP_KEY || env.TOKEN_KEY;

export async function makeBackup(env: Env, now: number): Promise<string> {
  const payload = {
    version: 1,
    createdAt: isoNoMs(now),
    tables: await dumpAll(env, { secrets: true }),
  };
  return encrypt(JSON.stringify(payload), backupKey(env));
}

/**
 * Replace all data with a backup. The blob must decrypt with our key; table and column names are
 * checked against the live schema, so a crafted backup cannot inject SQL or touch other tables.
 */
export async function restoreBackup(
  env: Env,
  blob: string,
): Promise<{ restored: Record<string, number> }> {
  let payload: { version?: number; tables?: Record<string, Row[]> };
  try {
    payload = JSON.parse(await decrypt(blob.trim(), backupKey(env)));
  } catch {
    throw new Error('backup_unreadable');
  }
  if (payload.version !== 1 || typeof payload.tables !== 'object' || payload.tables === null)
    throw new Error('backup_unreadable');

  const plan: { table: Table; cols: string[]; rows: Row[] }[] = [];
  for (const t of BACKUP_TABLES) {
    const rows = payload.tables[t] ?? [];
    if (!Array.isArray(rows)) throw new Error('backup_unreadable');
    const live = await columns(env, t);
    for (const r of rows) {
      if (typeof r !== 'object' || r === null) throw new Error('backup_unreadable');
      for (const k of Object.keys(r))
        if (!live.includes(k)) throw new Error('backup_has_unknown_columns');
    }
    plan.push({ table: t, cols: live, rows });
  }
  const stmts = [...BACKUP_TABLES].reverse().map((t) => env.DB.prepare(`DELETE FROM ${t}`));
  // events and shift_changes hang off calendar_sources and are rebuilt by the next sync
  stmts.unshift(env.DB.prepare('DELETE FROM events'), env.DB.prepare('DELETE FROM shift_changes'));
  const restored: Record<string, number> = {};
  for (const { table, cols, rows } of plan) {
    restored[table] = rows.length;
    for (const r of rows) {
      const keys = cols.filter((c) => c in r);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        ).bind(...keys.map((k) => r[k] ?? null)),
      );
    }
  }
  await env.DB.batch(stmts);
  return { restored };
}

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: Row[]): string => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  return (
    [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
  );
};

/* ------------------------------ notifications ------------------------------ */

const TOPIC = /^[A-Za-z0-9_-]{8,64}$/;

/** Send a phone notification through ntfy. The browser never talks to ntfy; the topic stays encrypted. */
export async function notify(
  env: Env,
  f: typeof fetch,
  title: string,
  message: string,
): Promise<boolean> {
  const cfg = await getSetting<{ topicEnc: string }>(env, 'ntfy');
  if (!cfg) return false;
  try {
    const topic = await decrypt(cfg.topicEnc, env.TOKEN_KEY);
    const res = await f(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: title.slice(0, 100).replace(/[^\x20-\x7e]/g, ''),
        'content-type': 'text/plain',
      },
      body: message.slice(0, 500),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Bedtime reminder: once a day, 30 minutes before suggested bedtime, if you turned it on. */
export async function runReminders(c: Pick<Ctx, 'env' | 'now' | 'fetchImpl'>): Promise<number> {
  if (!(await getSetting<boolean>(c.env, 'notify_bedtime'))) return 0;
  const s = await suggestionFor(c.env, c.now());
  const at = s.bedtime - 30 * 60_000;
  if (c.now() < at || c.now() > at + 15 * 60_000) return 0;
  const key = `reminder:bedtime:${localDateKey(at, s.timezone)}`;
  if (await getSetting(c.env, key)) return 0;
  await setSetting(c.env, key, true);
  return (await notify(
    c.env,
    c.fetchImpl,
    'Bedtime soon',
    `Be in bed by ${new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, hour: 'numeric', minute: '2-digit' }).format(s.bedtime)} (${s.basedOn}).`,
  ))
    ? 1
    : 0;
}

/* -------------------------------- backups -------------------------------- */

/** Nightly: store an encrypted backup in R2 (if bound) once per day and keep two weeks. */
export async function runNightlyBackup(env: Env, now: number): Promise<boolean> {
  if (!env.BACKUPS) return false;
  const day = new Date(now).toISOString().slice(0, 10);
  if ((await getSetting<string>(env, 'last_backup')) === day) return false;
  await env.BACKUPS.put(`backup-${day}.enc`, await makeBackup(env, now));
  await setSetting(env, 'last_backup', day);
  const list = await env.BACKUPS.list({ prefix: 'backup-' });
  const old = list.objects
    .map((o) => o.key)
    .sort()
    .slice(0, -14);
  for (const k of old) await env.BACKUPS.delete(k);
  return true;
}

/* -------------------------------- family link -------------------------------- */

const sha256 = async (s: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Public, read-only view for the family link. Authenticated only by an unguessable, expiring token.
 * It shows school, family and Dashboard events (never work shifts, locations or health data).
 * Every failure looks the same (404) so nothing can be probed.
 */
export async function familyView(req: Request, env: Env, now: number): Promise<Response> {
  const notFound = new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
  const t = new URL(req.url).searchParams.get('t') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(t)) return notFound;
  const row = await env.DB.prepare('SELECT expires_at FROM family_links WHERE token_hash = ?')
    .bind(await sha256(t))
    .first<{ expires_at: number }>();
  if (!row || row.expires_at < now) return notFound;
  const p = await loadProfile({ env });
  const today = localDateKey(now, p.timezone);
  const from = atLocal(today, '00:00', p.timezone);
  const to = atLocal(addDaysKey(today, 7), '00:00', p.timezone);
  const ev = await env.DB.prepare(
    "SELECT title, start, end, all_day, kind FROM events WHERE kind IN ('school','family') AND start < ? AND end > ? ORDER BY start LIMIT 100",
  )
    .bind(isoNoMs(to), isoNoMs(from))
    .all<{ title: string; start: string; end: string; all_day: number; kind: string }>();
  const dash = await env.DB.prepare(
    'SELECT title, start, end, all_day FROM dashboard_events WHERE start < ? AND end > ? ORDER BY start LIMIT 100',
  )
    .bind(isoNoMs(to), isoNoMs(from))
    .all<{ title: string; start: string; end: string; all_day: number }>();
  const events = [
    ...(ev.results ?? []),
    ...(dash.results ?? []).map((d) => ({ ...d, kind: 'family' })),
  ]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((e) => ({
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.all_day === 1,
      kind: e.kind,
    }));
  return new Response(
    JSON.stringify({
      name: p.name ? `${p.name}'s week` : 'This week',
      timezone: p.timezone,
      expiresAt: isoNoMs(row.expires_at),
      events,
    }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    },
  );
}

/* ---------------------------------- routes ---------------------------------- */

export const admin: Handler = async (c) => {
  const { env, path, method, req } = c;

  if (path === '/api/admin/export' && method === 'GET') {
    const format = c.url.searchParams.get('format') ?? 'json';
    const data = await dumpAll(env, { secrets: false });
    await audit(env, 'user', 'data.export', format, 'ok');
    if (format === 'csv') {
      const table = c.url.searchParams.get('table') ?? '';
      if (
        !(BACKUP_TABLES as readonly string[]).includes(table) ||
        table === 'audit_log' ||
        table === 'settings'
      )
        return err(400, 'unknown_table');
      return new Response(toCsv(data[table] ?? []), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${table}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }
    return new Response(JSON.stringify({ exportedAt: isoNoMs(c.now()), tables: data }, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="life-export.json"',
        'cache-control': 'no-store',
      },
    });
  }

  if (path === '/api/admin/backup' && method === 'POST') {
    const blob = await makeBackup(env, c.now());
    await audit(env, 'user', 'backup.download', 'encrypted', 'ok');
    return new Response(blob, {
      headers: {
        'content-type': 'text/plain',
        'content-disposition': `attachment; filename="life-backup-${isoNoMs(c.now()).slice(0, 10)}.enc"`,
        'cache-control': 'no-store',
      },
    });
  }
  if (path === '/api/admin/restore' && method === 'POST') {
    const b = await readJson(req, 20_000_000);
    if (b?.confirm !== 'RESTORE' || typeof b.blob !== 'string')
      return err(400, 'confirm_and_blob_required');
    try {
      const r = await restoreBackup(env, b.blob);
      await audit(env, 'user', 'backup.restore', 'all tables', 'ok');
      return json(r);
    } catch (e) {
      return err(400, e instanceof Error ? e.message : 'restore_failed');
    }
  }

  if (path === '/api/admin/kill' && method === 'POST') {
    const b = await readJson(req);
    if (b?.confirm !== 'REVOKE') return err(400, 'type_REVOKE_to_confirm');
    const n =
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_sources').first<{ n: number }>())
        ?.n ?? 0;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM settings WHERE key IN ('ha','ntfy','notify_bedtime')"),
      env.DB.prepare('DELETE FROM calendar_sources'), // feed addresses go; events and alerts cascade
      env.DB.prepare('DELETE FROM family_links'),
      env.DB.prepare('DELETE FROM confirmations'),
    ]);
    await audit(
      env,
      'user',
      'kill_switch',
      'all connections',
      `revoked home assistant, notifications, family links and ${n} calendar link(s)`,
    );
    return json({ ok: true, revoked: { calendars: n } });
  }

  if (path === '/api/notify/config' && method === 'GET') {
    return json({
      configured: !!(await getSetting(env, 'ntfy')),
      bedtimeReminder: !!(await getSetting(env, 'notify_bedtime')),
    });
  }
  if (path === '/api/notify/config' && method === 'PUT') {
    const b = await readJson(req);
    if (typeof b?.bedtimeReminder === 'boolean')
      await setSetting(env, 'notify_bedtime', b.bedtimeReminder);
    if (typeof b?.topic === 'string') {
      if (!TOPIC.test(b.topic)) return err(400, 'topic_must_be_8_to_64_letters_digits_dash');
      await setSetting(env, 'ntfy', { topicEnc: await encrypt(b.topic, env.TOKEN_KEY) });
      await audit(env, 'user', 'notify.configure', 'ntfy', 'ok');
    }
    return json({ ok: true });
  }
  if (path === '/api/notify/config' && method === 'DELETE') {
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('ntfy','notify_bedtime')").run();
    return json({ ok: true });
  }
  if (path === '/api/notify/test' && method === 'POST') {
    const ok = await notify(env, c.fetchImpl, 'Life Dashboard', 'Notifications are working.');
    return ok ? json({ ok: true }) : err(502, 'could_not_send');
  }

  if (path === '/api/family/link' && method === 'POST') {
    const b = await readJson(req);
    const days = Math.min(30, Math.max(1, Math.round(typeof b?.days === 'number' ? b.days : 7)));
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const expiresAt = c.now() + days * 86_400_000;
    await env.DB.prepare('INSERT INTO family_links (token_hash, expires_at) VALUES (?,?)')
      .bind(await sha256(token), expiresAt)
      .run();
    await audit(env, 'user', 'family.link', `${days} days`, 'created');
    return json({ token, expiresAt: isoNoMs(expiresAt) }, 201);
  }
  if (path === '/api/family/links' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT expires_at FROM family_links WHERE expires_at > ? ORDER BY expires_at',
    )
      .bind(c.now())
      .all<{ expires_at: number }>();
    return json({ links: (results ?? []).map((r) => isoNoMs(r.expires_at)) });
  }
  if (path === '/api/family/links' && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM family_links').run();
    await audit(env, 'user', 'family.link', 'all', 'revoked');
    return json({ ok: true });
  }

  void DATE;
  return null;
};
