import type { AuditSource } from '@life/shared';
import type { Env } from './env';
import type { FeedFetcher } from './sync';

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
export const err = (status: number, error: string): Response => json({ error }, status);

export async function readJson(
  req: Request,
  max = 20_000,
): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > max) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every write that touches a calendar, a device or a connection is recorded here. */
export async function audit(
  env: Env,
  source: AuditSource,
  action: string,
  target: string,
  result: string,
): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (source, action, target, result) VALUES (?,?,?,?)')
    .bind(source, action, target.slice(0, 300), result.slice(0, 300))
    .run();
}

/** Everything a route module needs. Time and outbound fetch are injectable so tests stay offline. */
export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  path: string;
  method: string;
  now: () => number;
  getFeed?: FeedFetcher;
  fetchImpl: typeof fetch;
}
export type Handler = (c: Ctx) => Promise<Response | null>;

export const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null;
export const isoNoMs = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const newId = (): string => crypto.randomUUID();

export async function getSetting<T>(env: Env, key: string): Promise<T | null> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  if (!r) return null;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return null;
  }
}
export async function setSetting(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(key, JSON.stringify(value))
    .run();
}
