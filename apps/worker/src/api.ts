import type { CalEvent, CalendarSource, ShiftChange, SourceKind } from '@life/shared';
import { encrypt } from './crypto';
import { dashToEvent, foundation, type DashRow } from './foundation';
import { audit as auditLog, err, json, readJson, type Ctx, type Handler } from './http';
import type { Env } from './env';
import { syncSource, type FeedFetcher, type SourceRow } from './sync';
import { ISO } from './http';
import { isSameOrigin, isServiceIngest, normalizeFeedUrl } from './urlcheck';

const KINDS: readonly SourceKind[] = ['work', 'school', 'family'];
const MAX_SOURCES = 10;
const MAX_RANGE_MS = 62 * 86_400_000;

const audit = (env: Env, action: string, target: string, result: string) =>
  auditLog(env, 'user', action, target, result);

interface SourceDb extends SourceRow {
  last_error: string | null;
}
const toSource = (r: SourceDb): CalendarSource => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  host: r.host,
  lastSyncedAt: r.last_synced_at,
  lastError: r.last_error,
});

/** All /api routes below the auth gate. The caller has already verified the Access token. */
export async function handleApi(
  req: Request,
  env: Env,
  getFeed?: FeedFetcher,
  now: () => number = Date.now,
  fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  extra: Handler[] = [],
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const ctx: Ctx = { req, env, url, path, method, now, getFeed, fetchImpl };

  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(req) && !isServiceIngest(req, path))
    return err(403, 'cross_origin');

  if (path === '/api/events' && method === 'GET') {
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!ISO.test(from) || !ISO.test(to)) return err(400, 'from_and_to_must_be_iso_utc');
    const span = Date.parse(to) - Date.parse(from);
    if (!(span > 0) || span > MAX_RANGE_MS) return err(400, 'range_too_large');
    const { results } = await env.DB.prepare(
      `SELECT id, source_id, title, start, end, all_day, location, kind FROM events
       WHERE start < ? AND end > ? ORDER BY start LIMIT 1000`,
    )
      .bind(to, from)
      .all<{
        id: string;
        source_id: string;
        title: string;
        start: string;
        end: string;
        all_day: number;
        location: string | null;
        kind: CalEvent['kind'];
      }>();
    const events: CalEvent[] = (results ?? []).map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      title: r.title,
      start: r.start,
      end: r.end,
      allDay: r.all_day === 1,
      location: r.location,
      kind: r.kind,
    }));
    const dash = await env.DB.prepare(
      'SELECT id, title, start, end, all_day, location FROM dashboard_events WHERE start < ? AND end > ? ORDER BY start LIMIT 500',
    )
      .bind(to, from)
      .all<DashRow>();
    const all = [...events, ...(dash.results ?? []).map(dashToEvent)].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    return json({ events: all });
  }

  if (path === '/api/sources' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, kind, url_enc, host, last_synced_at, last_error FROM calendar_sources ORDER BY created_at',
    ).all<SourceDb>();
    return json({ sources: (results ?? []).map(toSource) });
  }

  if (path === '/api/sources' && method === 'POST') {
    const body = await readJson(req);
    if (!body) return err(400, 'bad_json');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const kind = body.kind as SourceKind;
    const feed = typeof body.url === 'string' ? normalizeFeedUrl(body.url) : null;
    if (!name || name.length > 60) return err(400, 'name_required');
    if (!KINDS.includes(kind)) return err(400, 'bad_kind');
    if (!feed) return err(400, 'feed_url_must_be_public_https');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_sources').first<{
      n: number;
    }>();
    if ((count?.n ?? 0) >= MAX_SOURCES) return err(400, 'too_many_sources');

    const id = crypto.randomUUID();
    const row: SourceDb = {
      id,
      name,
      kind,
      url_enc: await encrypt(feed.href, env.TOKEN_KEY),
      host: feed.host,
      last_synced_at: null,
      last_error: null,
    };
    await env.DB.prepare(
      'INSERT INTO calendar_sources (id, name, kind, url_enc, host) VALUES (?,?,?,?,?)',
    )
      .bind(row.id, row.name, row.kind, row.url_enc, row.host)
      .run();
    await audit(env, 'source.add', `${kind}:${name}@${row.host}`, 'ok');
    try {
      const r = await syncSource(env, row, now(), getFeed, fetchImpl);
      const fresh = await env.DB.prepare(
        'SELECT id, name, kind, url_enc, host, last_synced_at, last_error FROM calendar_sources WHERE id = ?',
      )
        .bind(id)
        .first<SourceDb>();
      return json({ source: toSource(fresh!), sync: r }, 201);
    } catch (e) {
      // Keep the source so the user can see the error and retry; the message never contains the URL.
      const fresh = await env.DB.prepare(
        'SELECT id, name, kind, url_enc, host, last_synced_at, last_error FROM calendar_sources WHERE id = ?',
      )
        .bind(id)
        .first<SourceDb>();
      return json(
        { source: toSource(fresh!), error: e instanceof Error ? e.message : 'sync_failed' },
        201,
      );
    }
  }

  const m = /^\/api\/sources\/([0-9a-f-]{36})(\/sync)?$/.exec(path);
  if (m) {
    const id = m[1]!;
    const src = await env.DB.prepare(
      'SELECT id, name, kind, url_enc, host, last_synced_at, last_error FROM calendar_sources WHERE id = ?',
    )
      .bind(id)
      .first<SourceDb>();
    if (!src) return err(404, 'not_found');

    if (m[2] && method === 'POST') {
      try {
        return json({ sync: await syncSource(env, src, now(), getFeed, fetchImpl) });
      } catch (e) {
        return err(502, e instanceof Error ? e.message : 'sync_failed');
      }
    }
    if (!m[2] && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM calendar_sources WHERE id = ?').bind(id).run();
      await audit(env, 'source.delete', `${src.kind}:${src.name}@${src.host}`, 'ok');
      return json({ ok: true });
    }
  }

  if (path === '/api/alerts' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.type, c.title, c.old_start, c.old_end, c.new_start, c.new_end, c.at, s.name AS source_name
       FROM shift_changes c JOIN calendar_sources s ON s.id = c.source_id
       WHERE c.acknowledged = 0 ORDER BY c.at DESC, c.id DESC LIMIT 50`,
    ).all<{
      id: number;
      type: ShiftChange['type'];
      title: string;
      old_start: string | null;
      old_end: string | null;
      new_start: string | null;
      new_end: string | null;
      at: string;
      source_name: string;
    }>();
    const alerts: ShiftChange[] = (results ?? []).map((r) => ({
      id: r.id,
      sourceName: r.source_name,
      type: r.type,
      title: r.title,
      old: r.old_start && r.old_end ? { start: r.old_start, end: r.old_end } : null,
      new: r.new_start && r.new_end ? { start: r.new_start, end: r.new_end } : null,
      at: r.at,
    }));
    return json({ alerts });
  }

  const a = /^\/api\/alerts\/(\d+)\/ack$/.exec(path);
  if (a && method === 'POST') {
    await env.DB.prepare('UPDATE shift_changes SET acknowledged = 1 WHERE id = ?')
      .bind(Number(a[1]))
      .run();
    return json({ ok: true });
  }

  for (const h of [foundation, ...extra]) {
    const r = await h(ctx);
    if (r) return r;
  }
  return err(404, 'not_found');
}
