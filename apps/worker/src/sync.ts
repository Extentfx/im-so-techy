import type { SourceKind } from '@life/shared';
import { decrypt } from './crypto';
import { diffEvents, type Comparable } from './diff';
import type { Env } from './env';
import { parseIcs, type ParsedEvent } from './ics';
import { fetchCalendarEvents } from './providers';
import { friendlyError, withToken } from './tokens';
import { notify } from './admin';
import { replan } from './plan';
import { normalizeFeedUrl } from './urlcheck';

const DAY = 86_400_000;
export const WINDOW_PAST_DAYS = 7;
export const WINDOW_FUTURE_DAYS = 90;
const MAX_BYTES = 2_000_000;
const MAX_EVENTS = 2000;

export interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  url_enc: string | null;
  host: string;
  last_synced_at: string | null;
  type: 'ics' | 'google' | 'microsoft';
  connection_id: string | null;
  remote_id: string | null;
}

export type FeedFetcher = (url: URL) => Promise<string>;

/** Fetch with timeout, size cap, and every redirect hop re-validated. Errors carry no URL. */
export const fetchFeed: FeedFetcher = async (start) => {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'text/calendar,*/*' },
      });
    } catch {
      throw new Error('Could not reach the calendar feed');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = normalizeFeedUrl(new URL(res.headers.get('location') ?? '', url).href);
      if (!next) throw new Error('Feed redirected somewhere not allowed');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Empty feed');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Feed is too large');
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    return new TextDecoder().decode(all);
  }
  throw new Error('Too many redirects');
};

const isoNoMs = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface SyncResult {
  events: number;
  changes: number;
  warnings: string[];
}

/** Events for one calendar source: from its ICS link, or from the connected Google or Microsoft account. */
async function loadEvents(
  env: Env,
  src: SourceRow,
  now: number,
  getFeed: FeedFetcher,
  fetchImpl: typeof fetch,
): Promise<{ events: ParsedEvent[]; warnings: string[] }> {
  const from = now - WINDOW_PAST_DAYS * DAY;
  const to = now + WINDOW_FUTURE_DAYS * DAY;
  if (src.type === 'google' || src.type === 'microsoft') {
    if (!src.connection_id || !src.remote_id) throw new Error('connection_missing');
    const events = await withToken(env, fetchImpl, src.connection_id, now, (token) =>
      fetchCalendarEvents(
        fetchImpl,
        src.type as 'google' | 'microsoft',
        token,
        src.remote_id!,
        from,
        to,
      ),
    );
    return { events, warnings: [] };
  }
  const url = normalizeFeedUrl(await decrypt(src.url_enc ?? '', env.TOKEN_KEY));
  if (!url) throw new Error('Saved feed URL is no longer allowed');
  const text = await getFeed(url);
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link is not a calendar feed');
  return parseIcs(text, from, to);
}

export async function syncSource(
  env: Env,
  src: SourceRow,
  now = Date.now(),
  getFeed: FeedFetcher = fetchFeed,
  fetchImpl: typeof fetch = (i, init) => fetch(i, init),
): Promise<SyncResult> {
  try {
    const { events, warnings } = await loadEvents(env, src, now, getFeed, fetchImpl);
    const next = events.slice(0, MAX_EVENTS);
    // Ids are scoped by source and de-duplicated, so a feed repeating a UID can't collide.
    const seen = new Set<string>();
    const rows = next.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));

    // Only future-looking events matter for change alerts; first sync never alerts.
    const today = isoNoMs(now).slice(0, 10);
    const upcoming = (e: Comparable) => e.end.slice(0, 10) >= today;
    let changes: ReturnType<typeof diffEvents> = [];
    if (src.kind === 'work' && src.last_synced_at !== null) {
      const old = await env.DB.prepare(
        'SELECT key, title, start, end FROM events WHERE source_id = ?',
      )
        .bind(src.id)
        .all<Comparable>();
      changes = diffEvents((old.results ?? []).filter(upcoming), rows.filter(upcoming));
    }

    const stmts = [env.DB.prepare('DELETE FROM events WHERE source_id = ?').bind(src.id)];
    for (const e of rows) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO events (id, source_id, key, title, start, end, all_day, location, kind) VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(
          `${src.id}:${e.key}`,
          src.id,
          e.key,
          e.title,
          e.start,
          e.end,
          e.allDay ? 1 : 0,
          e.location,
          src.kind,
        ),
      );
    }
    for (const c of changes) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO shift_changes (source_id, type, title, old_start, old_end, new_start, new_end) VALUES (?,?,?,?,?,?,?)',
        ).bind(
          src.id,
          c.type,
          c.title,
          c.old?.start ?? null,
          c.old?.end ?? null,
          c.new?.start ?? null,
          c.new?.end ?? null,
        ),
      );
    }
    stmts.push(
      env.DB.prepare(
        'UPDATE calendar_sources SET last_synced_at = ?, last_error = NULL WHERE id = ?',
      ).bind(isoNoMs(now), src.id),
    );
    await env.DB.batch(stmts);
    // Events or shifts changed: keep proposed workouts consistent with the new calendar.
    if (changes.length) {
      await replan(env, now);
      const first = changes[0]!;
      await notify(
        env,
        fetchImpl,
        'Your schedule changed',
        `${src.name}: ${first.type} ${first.title}${changes.length > 1 ? ` and ${changes.length - 1} more` : ''}`,
      ).catch(() => false);
    }
    return { events: rows.length, changes: changes.length, warnings };
  } catch (err) {
    const msg = friendlyError(err);
    await env.DB.prepare('UPDATE calendar_sources SET last_error = ? WHERE id = ?')
      .bind(msg, src.id)
      .run();
    throw err;
  }
}

export async function syncAll(
  env: Env,
  now = Date.now(),
  getFeed: FeedFetcher = fetchFeed,
): Promise<void> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, kind, url_enc, host, last_synced_at, type, connection_id, remote_id FROM calendar_sources',
  ).all<SourceRow>();
  for (const s of results ?? []) {
    try {
      await syncSource(env, s, now, getFeed);
    } catch {
      /* error already recorded on the source row; keep going with the others */
    }
  }
}
