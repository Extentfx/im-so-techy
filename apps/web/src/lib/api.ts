import type { CalEvent, CalendarSource, ShiftChange, SourceKind } from '@life/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const FRIENDLY: Record<string, string> = {
  feed_url_must_be_public_https: 'Use a public https:// (or webcal://) calendar link.',
  name_required: 'Give the calendar a short name.',
  too_many_sources: 'You have reached the limit of 10 calendars.',
  bad_kind: 'Pick work, school or family.',
  cross_origin: 'Request blocked. Reload the page and try again.',
};
export const friendly = (e: unknown): string => {
  if (!(e instanceof ApiError)) return 'Could not reach the server.';
  if (e.status === 401) return 'Please sign in again.';
  if (e.code === 'network' || e.code === 'request_failed' || e.code === 'not_found')
    return 'Could not reach the server.';
  return FRIENDLY[e.code] ?? e.code.replace(/_/g, ' ');
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed');
  return data as T;
}

export const getEvents = (from: string, to: string) =>
  call<{ events: CalEvent[] }>(
    'GET',
    `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ).then((r) => r.events);
export const getSources = () =>
  call<{ sources: CalendarSource[] }>('GET', '/api/sources').then((r) => r.sources);
export const addSource = (b: { name: string; kind: SourceKind; url: string }) =>
  call<{ source: CalendarSource; error?: string }>('POST', '/api/sources', b);
export const syncSource = (id: string) =>
  call<{ sync: { events: number; changes: number } }>('POST', `/api/sources/${id}/sync`);
export const removeSource = (id: string) => call<{ ok: true }>('DELETE', `/api/sources/${id}`);
export const getAlerts = () =>
  call<{ alerts: ShiftChange[] }>('GET', '/api/alerts').then((r) => r.alerts);
export const ackAlert = (id: number) => call<{ ok: true }>('POST', `/api/alerts/${id}/ack`);
