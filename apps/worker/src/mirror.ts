/**
 * Optional mirror of approved events into a "Life Dashboard" calendar in your Google account.
 * It only runs after you approve an event, only when you switched it on, and the Google permission
 * we ask for (`calendar.app.created`) can reach nothing except calendars this app created itself.
 * The local Dashboard calendar stays the source of truth; a failed mirror never blocks an approval.
 */
import type { AuditSource } from '@life/shared';
import type { Env } from './env';
import { audit, getSetting, setSetting } from './http';
import { createDashboardCalendar, createEvent, deleteEvent } from './providers';
import { featuresOf, loadConnection, withToken } from './tokens';

interface Mirror {
  connectionId: string;
}
interface MirrorCalendar {
  connectionId: string;
  calendarId: string;
}

export interface MirrorEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}

export async function mirrorApproved(
  c: { env: Env; now: () => number; fetchImpl: typeof fetch },
  localId: string,
  ev: MirrorEvent,
  tz: string,
  source: AuditSource,
): Promise<void> {
  const { env } = c;
  const mirror = await getSetting<Mirror>(env, 'mirror');
  if (!mirror) return;
  try {
    const conn = await loadConnection(env, mirror.connectionId);
    if (!conn || conn.provider !== 'google' || !featuresOf(conn).includes('calendar')) return;
    const remoteId = await withToken(env, c.fetchImpl, conn.id, c.now(), async (token) => {
      let cal = await getSetting<MirrorCalendar>(env, 'mirror_calendar');
      if (!cal || cal.connectionId !== conn.id) {
        cal = {
          connectionId: conn.id,
          calendarId: await createDashboardCalendar(c.fetchImpl, token, tz),
        };
        await setSetting(env, 'mirror_calendar', cal);
      }
      return createEvent(c.fetchImpl, token, cal.calendarId, ev);
    });
    await env.DB.prepare('UPDATE dashboard_events SET remote_id = ? WHERE id = ?')
      .bind(remoteId, localId)
      .run();
    await audit(
      env,
      source,
      'calendar.mirror',
      `google:${ev.title}`,
      'written to the Life Dashboard calendar',
    );
  } catch {
    await audit(
      env,
      source,
      'calendar.mirror',
      `google:${ev.title}`,
      'failed; the event is still on your Dashboard calendar here',
    );
  }
}

export async function unmirror(
  c: { env: Env; now: () => number; fetchImpl: typeof fetch },
  remoteId: string | null,
): Promise<void> {
  if (!remoteId) return;
  const { env } = c;
  const cal = await getSetting<MirrorCalendar>(env, 'mirror_calendar');
  if (!cal) return;
  try {
    await withToken(env, c.fetchImpl, cal.connectionId, c.now(), (token) =>
      deleteEvent(c.fetchImpl, token, cal.calendarId, remoteId),
    );
  } catch {
    /* already gone, or disconnected: nothing to do */
  }
}
