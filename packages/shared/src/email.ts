/**
 * Email understanding without any tools or side effects: categorise, summarise and find dates.
 * Email is untrusted input. Nothing here can send, delete or change anything; the caller only turns
 * the result into a digest row and *proposals* that need a tap.
 */
import { addDaysKey, atLocal, localDateKey, localParts } from './tz';

export const EMAIL_CATEGORIES = ['school', 'work', 'family', 'bills', 'other'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

const KEYWORDS: Record<Exclude<EmailCategory, 'other'>, string[]> = {
  school: [
    'school',
    'teacher',
    'class',
    'classroom',
    'homework',
    'assignment',
    'parent-teacher',
    'principal',
    'pta',
    'semester',
    'syllabus',
    'student',
    'field trip',
    'lunch menu',
    'report card',
    'canvas',
  ],
  work: [
    'shift',
    'schedule',
    'roster',
    'meeting',
    'manager',
    'timesheet',
    'payroll',
    'project',
    'deadline',
    'standup',
    'on-call',
    'rota',
    'overtime',
  ],
  family: [
    'birthday',
    'dinner',
    'party',
    'grandma',
    'grandpa',
    'cousin',
    'wedding',
    'reunion',
    'family',
    'playdate',
    'sleepover',
    'visit',
  ],
  bills: [
    'invoice',
    'payment due',
    'bill',
    'statement',
    'amount due',
    'autopay',
    'balance',
    'subscription',
    'receipt',
    'renewal',
    'overdue',
  ],
};
const SENDER_HINTS: [RegExp, EmailCategory][] = [
  [/\.(edu|k12\.[a-z]{2}\.us)\b|school|district/i, 'school'],
  [/billing|invoice|payments?@|accounts?@|noreply@.*(bank|utility|energy|water)/i, 'bills'],
];

export function categorize(m: { from: string; subject: string; body: string }): EmailCategory {
  const text = `${m.subject} ${m.subject} ${m.body}`.toLowerCase(); // the subject counts double
  const score: Record<string, number> = { school: 0, work: 0, family: 0, bills: 0 };
  for (const [cat, words] of Object.entries(KEYWORDS))
    for (const w of words) if (text.includes(w)) score[cat]! += 1;
  for (const [re, cat] of SENDER_HINTS) if (re.test(m.from) && cat !== 'other') score[cat]! += 2;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? (best[0] as EmailCategory) : 'other';
}

/** Hide things that look like account numbers, card numbers, codes or addresses before anything is stored. */
export function redact(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d(?:[ -]?\d){5,}\b/g, '[number]')
    .replace(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{16,}\b/g, '[code]');
}

/** Strip links, quoted replies and signatures, then keep the first couple of sentences. */
export function summarize(body: string, max = 220): string {
  // eslint-disable-next-line no-control-regex
  const clean = body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const lines = clean.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (
      /^\s*>/.test(line) ||
      /^On .{5,80} wrote:$/.test(line.trim()) ||
      /^--\s*$/.test(line) ||
      /^(sent from my|get outlook for)/i.test(line.trim())
    ) {
      if (/^--\s*$/.test(line) || /^On .* wrote:$/.test(line.trim())) break;
      continue;
    }
    kept.push(line);
  }
  const text = redact(kept.join(' ').replace(/https?:\/\/\S+/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
  }
  return (out || text).trim().slice(0, max);
}

export interface FoundDate {
  dateKey: string;
  /** HH:MM, or null for an all-day item. */
  time: string | null;
  context: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

function timeNear(text: string, from: number): string | null {
  const win = text.slice(from, from + 40);
  const m =
    /\b(?:at|@|from|,)?\s*(noon|midnight)\b|\b(?:at|@|from|,)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b|\b(?:at|@)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(
      win,
    );
  if (!m) return null;
  if (m[1]) return m[1].toLowerCase() === 'noon' ? '12:00' : '00:00';
  if (m[2]) {
    let h = Number(m[2]);
    const mi = Number(m[3] ?? 0);
    const pm = /p/i.test(m[4]!);
    if (h < 1 || h > 12 || mi > 59) return null;
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${pad(h)}:${pad(mi)}`;
  }
  return m[5] ? `${pad(Number(m[5]))}:${m[6]}` : null;
}

/** Future dates mentioned in the text, as local dates with an optional time. At most `limit`. */
export function extractDates(text: string, now: number, tz: string, limit = 5): FoundDate[] {
  const todayKey = localDateKey(now, tz);
  const year = localParts(now, tz).y;
  const found: FoundDate[] = [];
  const add = (y: number, mo: number, d: number, idx: number, len: number, yearGiven: boolean) => {
    if (!valid(y, mo, d)) return;
    let key = `${y}-${pad(mo)}-${pad(d)}`;
    if (key < todayKey && !yearGiven) {
      if (!valid(y + 1, mo, d)) return;
      key = `${y + 1}-${pad(mo)}-${pad(d)}`; // "March 5" said in December means next March
    }
    if (key < todayKey) return;
    if (found.some((f) => f.dateKey === key && f.time === timeNear(text, idx + len))) return;
    const ctx = text
      .slice(Math.max(0, idx - 40), idx + len + 40)
      .replace(/\s+/g, ' ')
      .trim();
    found.push({ dateKey: key, time: timeNear(text, idx + len), context: ctx });
  };

  let m: RegExpExecArray | null;
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(text))) add(+m[1]!, +m[2]!, +m[3]!, m.index, m[0].length, true);

  const monthFirst = new RegExp(
    `\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,
    'gi',
  );
  while ((m = monthFirst.exec(text)))
    add(
      m[3] ? +m[3] : year,
      MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)) + 1,
      +m[2]!,
      m.index,
      m[0].length,
      !!m[3],
    );

  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join('|')})[a-z]*\\.?(?:,?\\s+(20\\d{2}))?\\b`,
    'gi',
  );
  while ((m = dayFirst.exec(text)))
    add(
      m[3] ? +m[3] : year,
      MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)) + 1,
      +m[1]!,
      m.index,
      m[0].length,
      !!m[3],
    );

  const us = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g;
  while ((m = us.exec(text))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
    add(y, +m[1]!, +m[2]!, m.index, m[0].length, !!m[3]);
  }

  const rel = new RegExp(
    `\\b(tomorrow|today|(?:next|this|on)\\s+(${WEEKDAYS.join('|')}))\\b`,
    'gi',
  );
  while ((m = rel.exec(text))) {
    let key: string | null = null;
    if (m[1]!.toLowerCase() === 'tomorrow') key = addDaysKey(todayKey, 1);
    else if (m[1]!.toLowerCase() === 'today') key = todayKey;
    else if (m[2]) {
      const target = WEEKDAYS.indexOf(m[2].toLowerCase());
      const cur = localParts(now, tz).dow;
      let diff = (target - cur + 7) % 7;
      if (diff === 0) diff = 7;
      if (
        /^next/i.test(m[1]!) &&
        diff <= 7 - 0 &&
        (target - cur + 7) % 7 !== 0 &&
        diff < 7 - cur + target
      )
        diff += 0;
      key = addDaysKey(todayKey, diff);
    }
    if (key) {
      const [y, mo, d] = key.split('-').map(Number) as [number, number, number];
      add(y, mo, d, m.index, m[0].length, true);
    }
  }
  return found
    .sort(
      (a, b) => a.dateKey.localeCompare(b.dateKey) || (a.time ?? '').localeCompare(b.time ?? ''),
    )
    .slice(0, limit);
}

export const cleanSubject = (s: string): string =>
  s
    .replace(/^((re|fwd?|fw):\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Event from email';

export interface EventDraft {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

/** Draft a calendar event from a found date. Timed events default to one hour. */
export function draftEvent(subject: string, d: FoundDate, tz: string): EventDraft {
  const title = cleanSubject(subject);
  if (!d.time) return { title, start: d.dateKey, end: addDaysKey(d.dateKey, 1), allDay: true };
  const start = atLocal(d.dateKey, d.time, tz);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { title, start: iso(start), end: iso(start + 3_600_000), allDay: false };
}

/** Validate untrusted model output into the same shape the rules produce. Anything off is dropped. */
export function parseLlmEmail(raw: unknown): { category: EmailCategory; summary: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const category = (EMAIL_CATEGORIES as readonly unknown[]).includes(r.category)
    ? (r.category as EmailCategory)
    : null;
  const summary =
    typeof r.summary === 'string'
      ? redact(r.summary.replace(/https?:\/\/\S+/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 220)
      : '';
  return category && summary ? { category, summary } : null;
}
