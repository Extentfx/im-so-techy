/**
 * Google and Microsoft: sign-in requests, scopes, and the calendar and mail calls we make.
 *
 * Least privilege, by design:
 *  - Mail is read-only (gmail.readonly, Mail.Read). Nothing can send, delete or label.
 *  - Calendars are read-only (calendar.readonly, Calendars.Read), plus for Google only
 *    `calendar.app.created`, which can touch only calendars this app creates itself.
 *
 * Every function takes the `fetch` to use, so tests run against stand-in servers.
 */
import type { Env } from './env';
import type { ParsedEvent } from './ics';

export type Provider = 'google' | 'microsoft';
export type Feature = 'mail' | 'calendar';
export const PROVIDERS: readonly Provider[] = ['google', 'microsoft'];
export const FEATURES: readonly Feature[] = ['mail', 'calendar'];

const MAX_BODY = 8000;
const isoNoMs = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/* --------------------------------- sign-in --------------------------------- */

export function creds(env: Env, p: Provider): { clientId: string; clientSecret: string } | null {
  const id = p === 'google' ? env.GOOGLE_CLIENT_ID : env.MS_CLIENT_ID;
  const secret = p === 'google' ? env.GOOGLE_CLIENT_SECRET : env.MS_CLIENT_SECRET;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

const msBase = (env: Env) =>
  `https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT || 'common')}/oauth2/v2.0`;
export const endpoints = (env: Env, p: Provider) =>
  p === 'google'
    ? {
        auth: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
      }
    : { auth: `${msBase(env)}/authorize`, token: `${msBase(env)}/token`, revoke: null };

export function scopesFor(p: Provider, features: readonly Feature[]): string[] {
  const mail = features.includes('mail');
  const cal = features.includes('calendar');
  if (p === 'google') {
    return [
      'openid',
      'email',
      ...(mail ? ['https://www.googleapis.com/auth/gmail.readonly'] : []),
      ...(cal
        ? [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/calendar.app.created',
          ]
        : []),
    ];
  }
  return [
    'offline_access',
    'openid',
    'email',
    'User.Read',
    ...(mail ? ['Mail.Read'] : []),
    ...(cal ? ['Calendars.Read'] : []),
  ];
}

export function buildAuthUrl(
  env: Env,
  p: Provider,
  a: { redirectUri: string; state: string; challenge: string; features: readonly Feature[] },
): string {
  const c = creds(env, p)!;
  const u = new URL(endpoints(env, p).auth);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', a.redirectUri);
  u.searchParams.set('scope', scopesFor(p, a.features).join(' '));
  u.searchParams.set('state', a.state);
  u.searchParams.set('code_challenge', a.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (p === 'google') {
    u.searchParams.set('access_type', 'offline'); // so we receive a refresh token
    u.searchParams.set('prompt', 'consent');
  }
  return u.toString();
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

async function tokenRequest(
  env: Env,
  f: typeof fetch,
  p: Provider,
  form: Record<string, string>,
  now: number,
): Promise<Tokens> {
  const c = creds(env, p)!;
  const res = await f(endpoints(env, p).token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      ...form,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!res.ok || !j.access_token)
    throw new Error(j.error === 'invalid_grant' ? 'invalid_grant' : `token_${res.status}`);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: now + (Number(j.expires_in) || 3600) * 1000,
    scope: j.scope ?? '',
  };
}

export const exchangeCode = (
  env: Env,
  f: typeof fetch,
  p: Provider,
  code: string,
  redirectUri: string,
  verifier: string,
  now: number,
) =>
  tokenRequest(
    env,
    f,
    p,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier },
    now,
  );

export const refreshTokens = (
  env: Env,
  f: typeof fetch,
  p: Provider,
  refreshToken: string,
  now: number,
) => tokenRequest(env, f, p, { grant_type: 'refresh_token', refresh_token: refreshToken }, now);

export async function revokeToken(
  env: Env,
  f: typeof fetch,
  p: Provider,
  token: string,
): Promise<void> {
  const url = endpoints(env, p).revoke;
  if (!url) return; // Microsoft has no revoke call; the user removes the app in their account settings
  await f(`${url}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(6000),
  }).catch(() => undefined);
}

/** The signed-in account's email address. */
export async function accountEmail(f: typeof fetch, p: Provider, token: string): Promise<string> {
  const j = (await get(
    f,
    p,
    token,
    p === 'google'
      ? 'https://openidconnect.googleapis.com/v1/userinfo'
      : 'https://graph.microsoft.com/v1.0/me',
  )) as { email?: string; mail?: string; userPrincipalName?: string };
  const e = j.email ?? j.mail ?? j.userPrincipalName ?? '';
  if (!e) throw new Error('no_account_email');
  return e.slice(0, 200).toLowerCase();
}

/* ---------------------------------- http ---------------------------------- */

async function call(
  f: typeof fetch,
  p: Provider,
  token: string,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const res = await f(url, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`${p}_${res.status}`); // never include the body: it can echo what we sent
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const get = (
  f: typeof fetch,
  p: Provider,
  token: string,
  url: string,
  headers?: Record<string, string>,
) => call(f, p, token, url, { headers });

/* ------------------------------ pure mapping ------------------------------ */

type GDate = { dateTime?: string; date?: string };
interface GEvent {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: GDate;
  end?: GDate;
}

export function mapGoogleEvent(i: GEvent): ParsedEvent | null {
  if (!i.id || i.status === 'cancelled' || !i.start || !i.end) return null;
  const allDay = !!i.start.date && !i.start.dateTime;
  const ok = (d: GDate) =>
    allDay ? /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') : !Number.isNaN(Date.parse(d.dateTime ?? ''));
  if (!ok(i.start) || !ok(i.end)) return null;
  return {
    key: i.id,
    title: (i.summary ?? '').trim().slice(0, 200) || '(no title)',
    start: allDay ? i.start.date! : isoNoMs(Date.parse(i.start.dateTime!)),
    end: allDay ? i.end.date! : isoNoMs(Date.parse(i.end.dateTime!)),
    allDay,
    location: i.location?.trim().slice(0, 200) || null,
  };
}

interface MsEvent {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

/** Requested with `Prefer: outlook.timezone="UTC"`, so times are UTC without a trailing Z. */
export function mapMsEvent(i: MsEvent): ParsedEvent | null {
  if (!i.id || i.isCancelled || !i.start?.dateTime || !i.end?.dateTime) return null;
  const utc = (s: string) => Date.parse(s.endsWith('Z') ? s : `${s}Z`);
  if (Number.isNaN(utc(i.start.dateTime)) || Number.isNaN(utc(i.end.dateTime))) return null;
  const allDay = !!i.isAllDay;
  return {
    key: i.id,
    title: (i.subject ?? '').trim().slice(0, 200) || '(no title)',
    start: allDay ? i.start.dateTime.slice(0, 10) : isoNoMs(utc(i.start.dateTime)),
    end: allDay ? i.end.dateTime.slice(0, 10) : isoNoMs(utc(i.end.dateTime)),
    allDay,
    location: i.location?.displayName?.trim().slice(0, 200) || null,
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const fromB64Url = (s: string): string => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

interface GPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GPart[];
}
/** Prefer the plain-text part; fall back to HTML turned into text. */
export function extractGmailText(part: GPart | undefined): string {
  if (!part) return '';
  const found: { plain: string[]; html: string[] } = { plain: [], html: [] };
  const walk = (x: GPart) => {
    if (x.mimeType === 'text/plain' && x.body?.data) found.plain.push(fromB64Url(x.body.data));
    else if (x.mimeType === 'text/html' && x.body?.data) found.html.push(fromB64Url(x.body.data));
    for (const c of x.parts ?? []) walk(c);
  };
  walk(part);
  const text = found.plain.length ? found.plain.join('\n') : htmlToText(found.html.join('\n'));
  return text.slice(0, MAX_BODY);
}

export interface Message {
  id: string;
  from: string;
  subject: string;
  body: string;
}

interface GMessage {
  id?: string;
  labelIds?: string[];
  payload?: GPart & { headers?: { name: string; value: string }[] };
}
export function gmailToMessage(m: GMessage): Message | null {
  if (!m.id) return null;
  const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
  const body = extractGmailText(m.payload);
  return body.trim()
    ? { id: m.id, from: h('from').slice(0, 200), subject: h('subject').slice(0, 200), body }
    : null;
}

interface MsMessage {
  id?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { content?: string; contentType?: string };
}
export function msToMessage(m: MsMessage): Message | null {
  if (!m.id || !m.body?.content) return null;
  const text = m.body.contentType === 'html' ? htmlToText(m.body.content) : m.body.content;
  return text.trim()
    ? {
        id: m.id,
        from: (m.from?.emailAddress?.address ?? '').slice(0, 200),
        subject: (m.subject ?? '').slice(0, 200),
        body: text.slice(0, MAX_BODY),
      }
    : null;
}

/* ---------------------------------- Google ---------------------------------- */

const CAL = 'https://www.googleapis.com/calendar/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface RemoteCalendar {
  id: string;
  name: string;
}

export async function listCalendars(
  f: typeof fetch,
  p: Provider,
  token: string,
): Promise<RemoteCalendar[]> {
  if (p === 'google') {
    const j = (await get(f, p, token, `${CAL}/users/me/calendarList?minAccessRole=reader`)) as {
      items?: { id: string; summary?: string; summaryOverride?: string }[];
    };
    return (j.items ?? []).map((c) => ({
      id: c.id,
      name: (c.summaryOverride ?? c.summary ?? c.id).slice(0, 80),
    }));
  }
  const j = (await get(f, p, token, 'https://graph.microsoft.com/v1.0/me/calendars?$top=50')) as {
    value?: { id: string; name?: string }[];
  };
  return (j.value ?? []).map((c) => ({ id: c.id, name: (c.name ?? c.id).slice(0, 80) }));
}

export async function fetchCalendarEvents(
  f: typeof fetch,
  p: Provider,
  token: string,
  calendarId: string,
  fromMs: number,
  toMs: number,
): Promise<ParsedEvent[]> {
  const out: ParsedEvent[] = [];
  if (p === 'google') {
    let page = '';
    for (let i = 0; i < 4; i++) {
      const q = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        timeMin: isoNoMs(fromMs),
        timeMax: isoNoMs(toMs),
      });
      if (page) q.set('pageToken', page);
      const j = (await get(
        f,
        p,
        token,
        `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${q}`,
      )) as { items?: GEvent[]; nextPageToken?: string };
      for (const it of j.items ?? []) {
        const e = mapGoogleEvent(it);
        if (e) out.push(e);
      }
      if (!j.nextPageToken) break;
      page = j.nextPageToken;
    }
    return out;
  }
  const q = new URLSearchParams({
    startDateTime: isoNoMs(fromMs),
    endDateTime: isoNoMs(toMs),
    $top: '250',
    $select: 'id,subject,start,end,isAllDay,isCancelled,location',
  });
  const j = (await get(
    f,
    p,
    token,
    `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${q}`,
    { Prefer: 'outlook.timezone="UTC"' },
  )) as { value?: MsEvent[] };
  for (const it of j.value ?? []) {
    const e = mapMsEvent(it);
    if (e) out.push(e);
  }
  return out;
}

/** Inbox messages from the last few days, newest first, skipping ids in `skip`. Bodies are read, never kept. */
export async function fetchRecentMail(
  f: typeof fetch,
  p: Provider,
  token: string,
  a: { nowMs: number; sinceMs: number; max: number; skip: Set<string> },
): Promise<Message[]> {
  const out: Message[] = [];
  if (p === 'google') {
    const days = Math.max(1, Math.ceil((a.nowMs - a.sinceMs) / 86_400_000));
    const q = new URLSearchParams({
      q: `in:inbox newer_than:${Math.min(days, 7)}d`,
      maxResults: String(a.max * 2),
    });
    const list = (await get(f, p, token, `${GMAIL}/messages?${q}`)) as {
      messages?: { id: string }[];
    };
    for (const { id } of list.messages ?? []) {
      if (a.skip.has(id)) continue;
      const m = (await get(
        f,
        p,
        token,
        `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`,
      )) as GMessage;
      const msg = gmailToMessage(m);
      out.push(msg ?? { id, from: '', subject: '', body: '' }); // unreadable messages are still marked seen
      if (out.length >= a.max) break;
    }
    return out;
  }
  const q = new URLSearchParams({
    $top: String(a.max * 2),
    $orderby: 'receivedDateTime desc',
    $filter: `receivedDateTime ge ${isoNoMs(a.sinceMs)}`,
    $select: 'id,subject,from,body',
  });
  const j = (await get(
    f,
    p,
    token,
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${q}`,
    { Prefer: 'outlook.body-content-type="text"' },
  )) as { value?: (MsMessage & { id: string })[] };
  for (const m of j.value ?? []) {
    if (a.skip.has(m.id!)) continue;
    out.push(msToMessage(m) ?? { id: m.id!, from: '', subject: '', body: '' });
    if (out.length >= a.max) break;
  }
  return out;
}

/* ------------------------ Google: the app's own calendar ------------------------ */

export async function createDashboardCalendar(
  f: typeof fetch,
  token: string,
  timeZone: string,
): Promise<string> {
  const j = (await call(f, 'google', token, `${CAL}/calendars`, {
    method: 'POST',
    body: { summary: 'Life Dashboard', timeZone },
  })) as { id?: string };
  if (!j?.id) throw new Error('calendar_not_created');
  return j.id;
}

export async function createEvent(
  f: typeof fetch,
  token: string,
  calendarId: string,
  e: { title: string; start: string; end: string; allDay: boolean; location: string | null },
): Promise<string> {
  const when = (v: string) => (e.allDay ? { date: v } : { dateTime: v });
  const j = (await call(
    f,
    'google',
    token,
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      body: {
        summary: e.title,
        ...(e.location ? { location: e.location } : {}),
        start: when(e.start),
        end: when(e.end),
      },
    },
  )) as { id?: string };
  if (!j?.id) throw new Error('event_not_created');
  return j.id;
}

export async function deleteEvent(
  f: typeof fetch,
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await call(
    f,
    'google',
    token,
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  );
}
