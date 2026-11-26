import type { CalEvent, EventKind } from '@life/shared';

export const KIND_COLOR: Record<EventKind, string> = {
  work: '#5b7cff',
  school: '#f2a33a',
  family: '#2fbf8a',
  dashboard: '#b07cff',
};
export const KIND_LABEL: Record<EventKind, string> = {
  work: 'Work',
  school: 'School',
  family: 'Family',
  dashboard: 'Dashboard',
};

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Local midnight of the Monday that starts the week containing `d`. */
export function mondayOf(d: Date): Date {
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

export const isoNoMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** UTC range covering the local days [start, start + days). */
export function rangeOf(start: Date, days: number): { from: string; to: string } {
  return { from: isoNoMs(start), to: isoNoMs(addDays(start, days)) };
}

/** Local day keys an event touches. All-day ends are exclusive dates; timed ends are instants. */
export function dayKeysOf(e: Pick<CalEvent, 'start' | 'end' | 'allDay'>): string[] {
  const keys: string[] = [];
  if (e.allDay) {
    const [sy, sm, sd] = e.start.split('-').map(Number) as [number, number, number];
    const [ey, em, ed] = e.end.split('-').map(Number) as [number, number, number];
    for (
      let d = new Date(sy, sm - 1, sd), end = new Date(ey, em - 1, ed);
      d < end && keys.length < 31;
      d = addDays(d, 1)
    ) {
      keys.push(dayKey(d));
    }
    return keys.length ? keys : [e.start];
  }
  const s = new Date(e.start);
  const last = new Date(Math.max(Date.parse(e.start), Date.parse(e.end) - 1));
  for (
    let d = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    d <= last && keys.length < 31;
    d = addDays(d, 1)
  ) {
    keys.push(dayKey(d));
  }
  return keys;
}

/** All-day events first, then by start time. */
export function groupByDay(events: CalEvent[], days: Date[]): Map<string, CalEvent[]> {
  const out = new Map(days.map((d) => [dayKey(d), [] as CalEvent[]]));
  for (const e of events) {
    for (const k of dayKeysOf(e)) out.get(k)?.push(e);
  }
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  }
  return out;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function fmtRange(e: Pick<CalEvent, 'start' | 'end' | 'allDay'>): string {
  return e.allDay ? 'All day' : `${time(e.start)} – ${time(e.end)}`;
}

export function fmtWhen(start: string, end: string): string {
  const d = new Date(start).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${d}, ${time(start)} – ${time(end)}`;
}
