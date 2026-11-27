import { mirrorApproved, unmirror } from './mirror';
import { sanitizeProfile, type CalEvent, type Profile } from '@life/shared';
import {
  audit,
  DATE,
  err,
  getSetting,
  json,
  newId,
  readJson,
  setSetting,
  str,
  type Ctx,
  type Handler,
} from './http';

export async function loadProfile(c: Pick<Ctx, 'env'>): Promise<Profile> {
  return sanitizeProfile(await getSetting(c.env, 'profile'));
}

export interface DashRow {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: number;
  location: string | null;
}
export const dashToEvent = (r: DashRow): CalEvent => ({
  id: `dash:${r.id}`,
  sourceId: 'dashboard',
  title: r.title,
  start: r.start,
  end: r.end,
  allDay: r.all_day === 1,
  location: r.location,
  kind: 'dashboard',
});

export interface Proposal {
  id: string;
  source: 'user' | 'chat' | 'scheduler' | 'email';
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

interface PropRow {
  id: string;
  source: Proposal['source'];
  kind: string;
  summary: string;
  payload: string;
  status: string;
  created_at: string;
}
const toProposal = (r: PropRow): Proposal => ({
  id: r.id,
  source: r.source,
  kind: r.kind,
  summary: r.summary,
  payload: JSON.parse(r.payload) as Record<string, unknown>,
  status: r.status,
  createdAt: r.created_at,
});

/** Create a pending proposal. Nothing is written to a calendar or device until it is approved. */
export async function createProposal(
  env: Ctx['env'],
  p: {
    source: Proposal['source'];
    kind: 'calendar_event';
    summary: string;
    payload: {
      title: string;
      start: string;
      end: string;
      allDay?: boolean;
      location?: string | null;
    };
  },
): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    'INSERT INTO proposals (id, source, kind, summary, payload) VALUES (?,?,?,?,?)',
  )
    .bind(id, p.source, p.kind, p.summary.slice(0, 200), JSON.stringify(p.payload))
    .run();
  return id;
}

export const foundation: Handler = async (c) => {
  const { env, path, method, req } = c;

  if (path === '/api/profile' && method === 'GET') {
    const raw = await getSetting(env, 'profile');
    return json({ profile: await loadProfile(c), exists: raw !== null });
  }
  if (path === '/api/profile' && method === 'PUT') {
    const body = await readJson(req);
    if (!body) return err(400, 'bad_json');
    const profile = sanitizeProfile(body);
    await setSetting(env, 'profile', profile);
    return json({ profile });
  }

  if (path === '/api/proposals' && method === 'GET') {
    const status = c.url.searchParams.get('status') ?? 'pending';
    const { results } = await env.DB.prepare(
      'SELECT id, source, kind, summary, payload, status, created_at FROM proposals WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT 100',
    )
      .bind(status)
      .all<PropRow>();
    return json({ proposals: (results ?? []).map(toProposal) });
  }

  if (path === '/api/proposals' && method === 'POST') {
    const b = await readJson(req);
    const pl = b?.payload as Record<string, unknown> | undefined;
    const title = str(pl?.title, 120);
    const start = typeof pl?.start === 'string' ? pl.start : '';
    const end = typeof pl?.end === 'string' ? pl.end : '';
    const source =
      b?.source === 'scheduler' || b?.source === 'email' || b?.source === 'chat'
        ? b.source
        : 'user';
    if (
      !b ||
      b.kind !== 'calendar_event' ||
      !title ||
      Number.isNaN(Date.parse(start)) ||
      Number.isNaN(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start)
    ) {
      return err(400, 'bad_proposal');
    }
    const summary = str(b.summary, 200) ?? title;
    const id = await createProposal(env, {
      source,
      kind: 'calendar_event',
      summary,
      payload: { title, start, end, location: str(pl?.location, 120) },
    });
    return json({ id }, 201);
  }

  const m = /^\/api\/proposals\/([0-9a-f-]{36})\/(approve|reject)$/.exec(path);
  if (m && method === 'POST') {
    const row = await env.DB.prepare(
      'SELECT id, source, kind, summary, payload, status, created_at FROM proposals WHERE id = ?',
    )
      .bind(m[1])
      .first<PropRow>();
    if (!row) return err(404, 'not_found');
    if (row.status !== 'pending') return err(409, `already_${row.status}`);
    const p = toProposal(row);
    if (m[2] === 'reject') {
      await env.DB.prepare(
        "UPDATE proposals SET status = 'rejected', decided_at = datetime('now') WHERE id = ?",
      )
        .bind(p.id)
        .run();
      return json({ ok: true });
    }
    if (p.kind !== 'calendar_event') return err(400, 'unsupported_kind');
    const pl = p.payload as {
      title: string;
      start: string;
      end: string;
      allDay?: boolean;
      location?: string | null;
    };
    const eventId = newId();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO dashboard_events (id, title, start, end, all_day, location, proposal_id) VALUES (?,?,?,?,?,?,?)',
      ).bind(eventId, pl.title, pl.start, pl.end, pl.allDay ? 1 : 0, pl.location ?? null, p.id),
      env.DB.prepare(
        "UPDATE proposals SET status = 'approved', decided_at = datetime('now') WHERE id = ?",
      ).bind(p.id),
    ]);
    await audit(
      env,
      p.source,
      'calendar.write',
      `dashboard:${pl.title}@${pl.start}`,
      'approved by user',
    );
    // If you switched on the Google mirror, a copy goes into your "Life Dashboard" Google calendar.
    await mirrorApproved(
      c,
      eventId,
      {
        title: pl.title,
        start: pl.start,
        end: pl.end,
        allDay: !!pl.allDay,
        location: pl.location ?? null,
      },
      (await loadProfile(c)).timezone,
      p.source,
    );
    return json({ ok: true, eventId });
  }

  const d = /^\/api\/dashboard-events\/([0-9a-f-]{36})$/.exec(path);
  if (d && method === 'DELETE') {
    const old = await env.DB.prepare('SELECT remote_id FROM dashboard_events WHERE id = ?')
      .bind(d[1])
      .first<{ remote_id: string | null }>();
    const r = await env.DB.prepare('DELETE FROM dashboard_events WHERE id = ?').bind(d[1]).run();
    if (!r.meta.changes) return err(404, 'not_found');
    await unmirror(c, old?.remote_id ?? null);
    await audit(env, 'user', 'calendar.delete', `dashboard:${d[1]}`, 'ok');
    return json({ ok: true });
  }

  if (path === '/api/audit' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, at, source, action, target, result FROM audit_log ORDER BY id DESC LIMIT 100',
    ).all();
    return json({ audit: results ?? [] });
  }

  void DATE;
  return null;
};
