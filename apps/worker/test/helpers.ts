import { handleApi } from '../src/api';
import type { Env } from '../src/env';
import { allHandlers } from '../src/modules';
import type { FeedFetcher } from '../src/sync';
import { makeD1 } from './d1';

export const NOW = Date.parse('2026-03-02T08:00:00Z'); // a Monday

export interface Harness {
  env: Env;
  raw: ReturnType<typeof makeD1>['raw'];
  call: (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  json: <T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<T & { _status: number }>;
  setFeed: (t: string) => void;
  setFetch: (f: typeof fetch) => void;
  setNow: (ms: number) => void;
}

export function harness(extraEnv: Partial<Env> = {}): Harness {
  const d = makeD1();
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const env: Env = {
    DB: d.db,
    TOKEN_KEY: key,
    ACCESS_TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOWED_EMAIL: '',
    ...extraEnv,
  };
  let feed = '';
  let fetchImpl: typeof fetch = async () => new Response('no network in tests', { status: 599 });
  let now = NOW;
  const getFeed: FeedFetcher = async () => feed;
  const call: Harness['call'] = (method, path, body, headers = {}) =>
    handleApi(
      new Request(`https://life.example.com${path}`, {
        method,
        headers: {
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      getFeed,
      () => now,
      (i, init) => fetchImpl(i, init),
      allHandlers,
    );
  return {
    env,
    raw: d.raw,
    call,
    json: async (m, p, b) => {
      const r = await call(m, p, b);
      const t = await r.text();
      let data: Record<string, unknown> = {};
      try {
        data = t ? JSON.parse(t) : {};
      } catch {
        data = { _text: t };
      }
      return { ...data, _status: r.status } as never;
    },
    setFeed: (t) => (feed = t),
    setFetch: (f) => (fetchImpl = f),
    setNow: (ms) => (now = ms),
  };
}
