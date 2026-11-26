/** Time-zone helpers built on Intl, shared by the Worker and the web app. */

export function tzOffset(ts: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, Number(x.value)]));
  return (
    Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) -
    Math.floor(ts / 1000) * 1000
  );
}

export const WINDOWS_TZ: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
};

/** Convert wall-clock time in `tz` to a UTC timestamp. Unknown zones fall back to UTC. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string | undefined,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz) return guess;
  try {
    const zone = WINDOWS_TZ[tz] ?? tz;
    const first = guess - tzOffset(guess, zone);
    return guess - tzOffset(first, zone);
  } catch {
    return guess;
  }
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** 0 = Sunday */
  dow: number;
}

export function localParts(ms: number, tz: string): LocalParts {
  const off = (() => {
    try {
      return tzOffset(ms, tz);
    } catch {
      return 0;
    }
  })();
  const t = new Date(ms + off);
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes(),
    dow: t.getUTCDay(),
  };
}

/** UTC timestamp of local midnight at the start of the local day containing `ms`. */
export function localDayStart(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return zonedToUtc(p.y, p.mo, p.d, 0, 0, 0, tz);
}

/** `YYYY-MM-DD` of the local day containing `ms`. */
export function localDateKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** UTC timestamp of `HH:MM` on local date `YYYY-MM-DD`. */
export function atLocal(dateKey: string, hhmm: string, tz: string): number {
  const [y, mo, d] = dateKey.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  return zonedToUtc(y, mo, d, h, mi, 0, tz);
}

/** Date key `n` days after `dateKey` (calendar arithmetic, DST-safe). */
export function addDaysKey(dateKey: string, n: number): string {
  const [y, mo, d] = dateKey.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
