/**
 * Small, dependency-free iCalendar (ICS) reader.
 * Handles folded lines, UTC / TZID / floating times, all-day events, DURATION,
 * RECURRENCE-ID overrides, EXDATE and simple DAILY / WEEKLY recurrence.
 * Floating times are read as UTC. Other recurrence kinds keep only their first occurrence
 * and are reported in `warnings`.
 */

export interface ParsedEvent {
  /** Stable identity: the UID, plus the start time for each occurrence of a recurring event. */
  key: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}

export interface ParseResult {
  events: ParsedEvent[];
  warnings: string[];
}

const DAY = 86_400_000;
const MAX_OCCURRENCES = 400;

const WINDOWS_TZ: Record<string, string> = {
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

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

export const unescapeText = (s: string): string =>
  s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

export function parseLine(line: string): Prop | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Offset (ms) of a time zone from UTC at the given instant. */
function tzOffset(ts: number, tz: string): number {
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
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

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

interface Local {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  tz?: string;
  allDay: boolean;
  utc: boolean;
}

function parseDate(value: string, params: Record<string, string>): Local | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const allDay = params.VALUE === 'DATE' || m[4] === undefined;
  return {
    y: +m[1]!,
    mo: +m[2]!,
    d: +m[3]!,
    h: +(m[4] ?? 0),
    mi: +(m[5] ?? 0),
    s: +(m[6] ?? 0),
    tz: m[7] ? undefined : params.TZID,
    allDay,
    utc: m[7] === 'Z',
  };
}

const toMs = (l: Local): number =>
  zonedToUtc(l.y, l.mo, l.d, l.h, l.mi, l.s, l.utc ? undefined : l.tz);

const addDays = (l: Local, n: number): Local => {
  const t = new Date(Date.UTC(l.y, l.mo - 1, l.d + n));
  return { ...l, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoStr = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function parseDurationMs(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v);
  if (!m) return null;
  const ms =
    (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * DAY +
    +(m[4] ?? 0) * 3_600_000 +
    +(m[5] ?? 0) * 60_000 +
    +(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

interface Rule {
  freq: string;
  interval: number;
  count: number | null;
  until: number | null;
  byday: number[]; // 0 = Sunday
  unsupported: boolean;
}

const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(v: string): Rule {
  const r: Rule = {
    freq: '',
    interval: 1,
    count: null,
    until: null,
    byday: [],
    unsupported: false,
  };
  for (const part of v.split(';')) {
    const [k, val = ''] = part.split('=');
    if (k === 'FREQ') r.freq = val;
    else if (k === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (k === 'COUNT') r.count = parseInt(val, 10) || null;
    else if (k === 'UNTIL') {
      const l = parseDate(val, {});
      if (l) r.until = l.allDay ? Date.UTC(l.y, l.mo - 1, l.d, 23, 59, 59) : toMs(l);
    } else if (k === 'BYDAY') {
      for (const d of val.split(',')) {
        if (!/^(SU|MO|TU|WE|TH|FR|SA)$/.test(d))
          r.unsupported = true; // ordinals like 2MO
        else r.byday.push(DOW[d]!);
      }
    } else if (['BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'BYYEARDAY', 'BYWEEKNO'].includes(k!)) {
      r.unsupported = true;
    }
  }
  if (r.freq !== 'DAILY' && r.freq !== 'WEEKLY') r.unsupported = true;
  return r;
}

/** Start times of every occurrence from `first` within [fromMs, toMs]. */
function occurrences(first: Local, rule: Rule | null, fromMs: number, untilMs: number): Local[] {
  if (!rule || rule.unsupported) return [first];
  const out: Local[] = [];
  const firstDow = new Date(Date.UTC(first.y, first.mo - 1, first.d)).getUTCDay();
  const days = rule.freq === 'WEEKLY' ? (rule.byday.length ? [...rule.byday] : [firstDow]) : [];
  // Week anchored on Monday so INTERVAL > 1 steps whole weeks.
  const mondayOffset = (firstDow + 6) % 7;
  let n = 0;
  for (let step = 0; step < 5000; step++) {
    let candidates: Local[];
    if (rule.freq === 'DAILY') {
      candidates = [addDays(first, step * rule.interval)];
    } else {
      const weekStart = addDays(first, -mondayOffset + step * 7 * rule.interval);
      candidates = days
        .map((dow) => addDays(weekStart, (dow + 6) % 7))
        .sort((a, b) => toMs(a) - toMs(b));
    }
    for (const c of candidates) {
      const ms = toMs(c);
      if (ms < toMs(first)) continue;
      if (rule.until !== null && ms > rule.until) return out;
      if (rule.count !== null && n >= rule.count) return out;
      if (ms > untilMs) return out;
      n++;
      if (ms >= fromMs - DAY * 2) out.push(c);
      if (out.length >= MAX_OCCURRENCES) return out;
    }
  }
  return out;
}

export function parseIcs(text: string, fromMs: number, toMsWindow: number): ParseResult {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const events: ParsedEvent[] = [];
  const warnings: string[] = [];
  const overrides = new Set<string>(); // `${uid}@${origStartMs}` replaced by a RECURRENCE-ID event

  const blocks: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = [];
    else if (line === 'END:VEVENT') {
      if (cur) blocks.push(cur);
      cur = null;
    } else if (cur) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }

  for (const b of blocks) {
    const rid = b.find((p) => p.name === 'RECURRENCE-ID');
    const uid = b.find((p) => p.name === 'UID')?.value;
    const l = rid && parseDate(rid.value, rid.params);
    if (rid && uid && l) overrides.add(`${uid}@${toMs(l)}`);
  }

  for (const b of blocks) {
    const get = (n: string) => b.find((p) => p.name === n);
    if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
    const dts = get('DTSTART');
    const startL = dts && parseDate(dts.value, dts.params);
    if (!dts || !startL) continue;
    const uid = get('UID')?.value ?? `${dts.value}-${get('SUMMARY')?.value ?? ''}`;
    const title = unescapeText(get('SUMMARY')?.value ?? '').trim() || '(no title)';
    const loc = unescapeText(get('LOCATION')?.value ?? '').trim() || null;

    const startMs = toMs(startL);
    let durMs: number;
    const dte = get('DTEND');
    const dur = get('DURATION');
    const endL = dte && parseDate(dte.value, dte.params);
    if (endL) durMs = toMs(endL) - startMs;
    else if (dur && parseDurationMs(dur.value) !== null) durMs = parseDurationMs(dur.value)!;
    else durMs = startL.allDay ? DAY : 0;
    if (durMs < 0) durMs = 0;

    const rrule = get('RRULE');
    const rule = rrule ? parseRule(rrule.value) : null;
    if (rule?.unsupported)
      warnings.push(`Unsupported recurrence for "${title}": only the first occurrence is shown`);
    const exdates = new Set(
      b
        .filter((p) => p.name === 'EXDATE')
        .flatMap((p) => p.value.split(',').map((v) => parseDate(v, p.params)))
        .filter((x): x is Local => !!x)
        .map(toMs),
    );
    const recurring = !!rule;
    const isOverride = !!get('RECURRENCE-ID');

    for (const o of occurrences(startL, rule, fromMs, toMsWindow)) {
      const s = toMs(o);
      if (exdates.has(s)) continue;
      if (!isOverride && overrides.has(`${uid}@${s}`)) continue;
      const e = s + durMs;
      if (e < fromMs && s < fromMs) continue;
      if (s > toMsWindow) continue;
      const allDay = startL.allDay;
      // All-day dates are calendar dates, never shifted by a zone.
      const sISO = allDay ? `${pad(o.y, 4)}-${pad(o.mo)}-${pad(o.d)}` : isoStr(s);
      const eISO = allDay ? dateStr(Date.UTC(o.y, o.mo - 1, o.d) + durMs) : isoStr(e);
      events.push({
        key: recurring || isOverride ? `${uid}@${sISO}` : uid,
        title,
        start: sISO,
        end: eISO,
        allDay,
        location: loc,
      });
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, warnings };
}
