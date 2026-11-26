import { addDaysKey, localDateKey, suggestBedtime, type Commitment } from '@life/shared';
import {
  audit,
  DATE,
  err,
  getSetting,
  ISO,
  isoNoMs,
  json,
  readJson,
  setSetting,
  type Handler,
} from './http';
import { loadProfile } from './foundation';
import { loadBusy } from './plan';
import { recentNights, recoveryMode } from './recovery';
import { atLocal } from '@life/shared';

const MIN_MINUTES = 60;
const MAX_MINUTES = 16 * 60;

export const sleep: Handler = async (c) => {
  const { env, path, method, req } = c;

  async function record(bedAt: string, wakeAt: string, source: string): Promise<Response> {
    const minutes = Math.round((Date.parse(wakeAt) - Date.parse(bedAt)) / 60_000);
    if (!(minutes >= MIN_MINUTES && minutes <= MAX_MINUTES))
      return err(400, 'sleep_must_be_1_to_16_hours');
    if (Date.parse(wakeAt) > c.now() + 3_600_000) return err(400, 'wake_time_in_future');
    const profile = await loadProfile(c);
    const date = localDateKey(Date.parse(wakeAt), profile.timezone);
    await env.DB.prepare(
      'INSERT INTO sleep_log (date, bed_at, wake_at, minutes, source) VALUES (?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET bed_at = excluded.bed_at, wake_at = excluded.wake_at, minutes = excluded.minutes, source = excluded.source',
    )
      .bind(date, bedAt, wakeAt, minutes, source)
      .run();
    return json({ date, minutes }, 201);
  }

  if (path === '/api/sleep' && method === 'GET') {
    const profile = await loadProfile(c);
    const now = c.now();
    const today = localDateKey(now, profile.timezone);
    const nights = await recentNights(env, profile.timezone, now);
    const rec = await recoveryMode(env, now);
    const tomorrow = addDaysKey(today, 1);
    const busy = await loadBusy(
      env,
      atLocal(tomorrow, '00:00', profile.timezone),
      atLocal(addDaysKey(tomorrow, 1), '00:00', profile.timezone),
    );
    const { results } = await env.DB.prepare(
      'SELECT title, start FROM events WHERE all_day = 0 AND start >= ? AND start < ? ORDER BY start LIMIT 1',
    )
      .bind(
        isoNoMs(atLocal(tomorrow, '00:00', profile.timezone)),
        isoNoMs(atLocal(addDaysKey(tomorrow, 1), '00:00', profile.timezone)),
      )
      .all<{ title: string; start: string }>();
    const dash = await env.DB.prepare(
      'SELECT title, start FROM dashboard_events WHERE all_day = 0 AND start >= ? AND start < ? ORDER BY start LIMIT 1',
    )
      .bind(
        isoNoMs(atLocal(tomorrow, '00:00', profile.timezone)),
        isoNoMs(atLocal(addDaysKey(tomorrow, 1), '00:00', profile.timezone)),
      )
      .all<{ title: string; start: string }>();
    const commitments: Commitment[] = [...(results ?? []), ...(dash.results ?? [])].map((r) => ({
      title: r.title,
      start: Date.parse(r.start),
    }));
    void busy;
    const s = suggestBedtime(today, commitments, profile);
    return json({
      nights,
      targetHours: profile.sleepHours,
      debtHours: rec.debtHours,
      recovery: { light: rec.light, reason: rec.reason },
      open: (await getSetting<{ bedAt: string }>(env, 'sleep_open'))?.bedAt ?? null,
      suggestion: { bedtime: isoNoMs(s.bedtime), wake: isoNoMs(s.wake), basedOn: s.basedOn },
    });
  }
  if (path === '/api/sleep/bed' && method === 'POST') {
    await setSetting(env, 'sleep_open', { bedAt: isoNoMs(c.now()) });
    return json({ ok: true });
  }
  if (path === '/api/sleep/wake' && method === 'POST') {
    const open = await getSetting<{ bedAt: string }>(env, 'sleep_open');
    if (!open) return err(409, 'no_bedtime_recorded');
    const r = await record(open.bedAt, isoNoMs(c.now()), 'taps');
    if (r.ok) await env.DB.prepare("DELETE FROM settings WHERE key = 'sleep_open'").run();
    return r;
  }
  if ((path === '/api/sleep' || path === '/api/ingest/sleep') && method === 'POST') {
    const b = await readJson(req);
    const bedAt = typeof b?.bedAt === 'string' ? b.bedAt : '';
    const wakeAt = typeof b?.wakeAt === 'string' ? b.wakeAt : '';
    if (!ISO.test(bedAt) || !ISO.test(wakeAt)) return err(400, 'bedAt_and_wakeAt_must_be_iso_utc');
    const source = path === '/api/ingest/sleep' ? 'shortcut' : 'manual';
    const r = await record(bedAt, wakeAt, source);
    if (r.ok && source === 'shortcut') await audit(env, 'user', 'sleep.ingest', 'shortcut', 'ok');
    return r;
  }
  const d = /^\/api\/sleep\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (d && method === 'DELETE' && DATE.test(d[1]!)) {
    await env.DB.prepare('DELETE FROM sleep_log WHERE date = ?').bind(d[1]).run();
    return json({ ok: true });
  }
  return null;
};
