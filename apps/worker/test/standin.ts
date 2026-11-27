/**
 * A stand-in for Google and Microsoft: just enough of their sign-in, calendar and mail APIs to test against.
 * It records every request, and it checks the PKCE verifier against the challenge the way the real servers do.
 * These are NOT the real services; they follow the documented request and response shapes.
 */
export interface Req {
  url: string;
  host: string;
  path: string;
  method: string;
  auth: string | null;
  body: string;
  headers: Headers;
}

const b64url = (s: string | Uint8Array) =>
  btoa(typeof s === 'string' ? s : String.fromCharCode(...s))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const sha256b64url = async (v: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));

export const gmailMsg = (id: string, from: string, subject: string, text: string) => ({
  id,
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'From', value: from },
      { name: 'Subject', value: subject },
    ],
    body: { data: b64url(text) },
  },
});

export interface Standin {
  fetch: typeof fetch;
  reqs: Req[];
  /** challenge registered for the code, set by the test after reading the sign-in URL */
  challenge: string;
  state: {
    refreshToken: string | null; // what a code exchange returns
    invalidGrant: boolean; // make refresh fail like a revoked account
    failExchange: boolean;
    fail: Set<string>; // path fragments that should return 500
    expireOnce: boolean; // answer the next API call with 401
    gcalEvents: Record<string, unknown[]>;
    gmail: Record<string, unknown>;
    msMail: unknown[];
    msEvents: Record<string, unknown[]>;
    accessCounter: number;
  };
  calls: (frag: string) => Req[];
}

export function standin(): Standin {
  const reqs: Req[] = [];
  const state: Standin['state'] = {
    refreshToken: 'refresh-1',
    invalidGrant: false,
    failExchange: false,
    fail: new Set(),
    expireOnce: false,
    gcalEvents: {},
    gmail: {},
    msMail: [],
    msEvents: {},
    accessCounter: 0,
  };
  const out: Standin = {
    reqs,
    challenge: '',
    state,
    calls: (frag) => reqs.filter((r) => r.url.includes(frag)),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = init?.body ? String(init.body) : '';
      const r: Req = {
        url: String(input),
        host: url.host,
        path: url.pathname,
        method: init?.method ?? 'GET',
        auth: headers.get('authorization'),
        body,
        headers,
      };
      reqs.push(r);
      const json = (o: unknown, status = 200) =>
        new Response(JSON.stringify(o), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      for (const f of state.fail)
        if (r.url.includes(f)) return json({ error: 'boom with secret details' }, 500);

      // ----- token endpoints (Google and Microsoft share the same shape) -----
      if (r.path.endsWith('/token')) {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'authorization_code') {
          if (state.failExchange || form.get('code') !== 'good-code')
            return json({ error: 'invalid_grant' }, 400);
          if (
            !form.get('code_verifier') ||
            (await sha256b64url(form.get('code_verifier')!)) !== out.challenge
          )
            return json({ error: 'invalid_grant', error_description: 'PKCE mismatch' }, 400);
          if (!form.get('client_secret') || !form.get('redirect_uri'))
            return json({ error: 'invalid_client' }, 401);
          return json({
            access_token: `access-${++state.accessCounter}`,
            ...(state.refreshToken ? { refresh_token: state.refreshToken } : {}),
            expires_in: 3600,
            scope: 'scopes granted',
          });
        }
        if (form.get('grant_type') === 'refresh_token') {
          if (state.invalidGrant || form.get('refresh_token') !== state.refreshToken)
            return json({ error: 'invalid_grant' }, 400);
          return json({ access_token: `access-${++state.accessCounter}`, expires_in: 3600 });
        }
        return json({ error: 'unsupported_grant_type' }, 400);
      }
      if (r.path.endsWith('/revoke')) return new Response('', { status: 200 });

      // ----- API calls need a bearer token -----
      if (!r.auth?.startsWith('Bearer access-')) return json({ error: 'unauthenticated' }, 401);
      if (state.expireOnce) {
        state.expireOnce = false;
        return json({ error: 'expired' }, 401);
      }

      if (r.host === 'openidconnect.googleapis.com') return json({ email: 'Sam@Example.com' });
      if (r.host === 'graph.microsoft.com' && r.path === '/v1.0/me')
        return json({ mail: null, userPrincipalName: 'sam@outlook.test' });

      if (r.host === 'www.googleapis.com' && r.path === '/calendar/v3/users/me/calendarList')
        return json({
          items: [
            { id: 'primary', summary: 'Sam' },
            { id: 'hospital@group.calendar', summary: 'Hospital' },
          ],
        });
      if (
        r.host === 'www.googleapis.com' &&
        r.path === '/calendar/v3/calendars' &&
        r.method === 'POST'
      )
        return json({ id: 'dash-cal' });
      const ev = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(r.path);
      if (r.host === 'www.googleapis.com' && ev) {
        const cal = decodeURIComponent(ev[1]!);
        if (r.method === 'POST')
          return json({
            id: `remote-ev-${reqs.filter((x) => x.method === 'POST' && x.path.endsWith('/events')).length}`,
          });
        if (r.method === 'DELETE') return new Response(null, { status: 204 });
        return json({ items: state.gcalEvents[cal] ?? [] });
      }
      if (r.host === 'gmail.googleapis.com') {
        if (r.path.endsWith('/messages'))
          return json({ messages: Object.keys(state.gmail).map((id) => ({ id })) });
        const id = decodeURIComponent(r.path.split('/').pop()!);
        return state.gmail[id] ? json(state.gmail[id]) : json({ error: 'not found' }, 404);
      }

      if (r.host === 'graph.microsoft.com' && r.path === '/v1.0/me/calendars')
        return json({ value: [{ id: 'ms-cal-1', name: 'Calendar' }] });
      const msev = /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(r.path);
      if (r.host === 'graph.microsoft.com' && msev)
        return json({ value: state.msEvents[decodeURIComponent(msev[1]!)] ?? [] });
      if (r.host === 'graph.microsoft.com' && r.path === '/v1.0/me/mailFolders/inbox/messages')
        return json({ value: state.msMail });
      return json({ error: `unexpected ${r.method} ${r.url}` }, 404);
    },
  };
  return out;
}
