/**
 * Smart home through a Home Assistant bridge.
 *
 * Safety rules, all enforced here on the server:
 *  - Only devices you explicitly allowlisted can be controlled.
 *  - Locks, covers (garage doors) and alarm panels always need a second confirming call
 *    (a single-use token that expires in 60 seconds), and are rate limited harder.
 *  - Scenes cannot contain those sensitive devices.
 *  - The Home Assistant address and token are stored encrypted and never returned.
 *  - Every action is written to the audit log with who or what caused it.
 */
import type { AuditSource } from '@life/shared';
import { decrypt, encrypt } from './crypto';
import type { Env } from './env';
import {
  audit,
  err,
  getSetting,
  isoNoMs,
  json,
  newId,
  readJson,
  setSetting,
  str,
  type Ctx,
  type Handler,
} from './http';
import { normalizeHaUrl } from './urlcheck';
import { suggestionFor } from './bedtime';
import { localDateKey } from '@life/shared';

interface HaConfig {
  urlEnc: string;
  tokenEnc: string;
  host: string;
}

type ActionSpec = { service: string; domain?: string };

/** What each device type may do, mapped to Home Assistant services. Anything else is refused. */
const ACTIONS: Record<string, Record<string, ActionSpec>> = {
  light: {
    on: { service: 'turn_on' },
    off: { service: 'turn_off' },
    toggle: { service: 'toggle' },
  },
  switch: {
    on: { service: 'turn_on' },
    off: { service: 'turn_off' },
    toggle: { service: 'toggle' },
  },
  fan: { on: { service: 'turn_on' }, off: { service: 'turn_off' }, toggle: { service: 'toggle' } },
  input_boolean: {
    on: { service: 'turn_on' },
    off: { service: 'turn_off' },
    toggle: { service: 'toggle' },
  },
  climate: { set_temperature: { service: 'set_temperature' } },
  scene: { activate: { service: 'turn_on' } },
  lock: { lock: { service: 'lock' }, unlock: { service: 'unlock' } },
  cover: { open: { service: 'open_cover' }, close: { service: 'close_cover' } },
  alarm_control_panel: { arm_away: { service: 'alarm_arm_away' } },
};
export const SENSITIVE_DOMAINS = new Set(['lock', 'cover', 'alarm_control_panel']);
export const SUPPORTED_DOMAINS = Object.keys(ACTIONS);

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const domainOf = (entityId: string) => entityId.split('.')[0]!;

/* ---------------------------- Home Assistant client ---------------------------- */

async function haConfig(env: Env): Promise<{ base: string; token: string; host: string } | null> {
  const cfg = await getSetting<HaConfig>(env, 'ha');
  if (!cfg) return null;
  try {
    return {
      base: (await decrypt(cfg.urlEnc, env.TOKEN_KEY)).replace(/\/+$/, ''),
      token: await decrypt(cfg.tokenEnc, env.TOKEN_KEY),
      host: cfg.host,
    };
  } catch {
    return null;
  }
}

async function ha(
  env: Env,
  f: typeof fetch,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const cfg = await haConfig(env);
  if (!cfg) throw new Error('not_configured');
  const res = await f(`${cfg.base}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual', // never follow a redirect with the token attached
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`home_assistant_${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

interface State {
  entity_id: string;
  state: string;
  attributes?: { friendly_name?: string; temperature?: number };
}

async function states(env: Env, f: typeof fetch): Promise<State[]> {
  const s = (await ha(env, f, '/api/states')) as State[];
  return Array.isArray(s) ? s : [];
}

/* --------------------------------- policy --------------------------------- */

async function recentActs(env: Env, sinceMs: number, sensitiveOnly: boolean): Promise<number> {
  const since = isoNoMs(sinceMs).replace('T', ' ').replace('Z', '');
  const q = sensitiveOnly
    ? "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'device.act' AND at >= ? AND (target LIKE 'lock.%' OR target LIKE 'cover.%' OR target LIKE 'alarm_control_panel.%')"
    : "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'device.act' AND at >= ?";
  return (await env.DB.prepare(q).bind(since).first<{ n: number }>())?.n ?? 0;
}

export interface ActResult {
  ok?: true;
  needsConfirm?: true;
  token?: string;
  message?: string;
  status?: number;
  error?: string;
}

/** The single place any device action goes through, for users, scenes and routines alike. */
export async function executeAction(
  c: Pick<Ctx, 'env' | 'now' | 'fetchImpl'>,
  a: {
    entityId: string;
    action: string;
    value?: number;
    confirmToken?: string;
    source: AuditSource;
    allowSensitive: boolean;
  },
): Promise<ActResult> {
  const { env } = c;
  if (!ENTITY.test(a.entityId)) return { status: 400, error: 'bad_entity' };
  const dev = await env.DB.prepare('SELECT entity_id FROM devices WHERE entity_id = ?')
    .bind(a.entityId)
    .first();
  if (!dev) return { status: 403, error: 'device_not_allowlisted' };
  const domain = domainOf(a.entityId);
  const spec = ACTIONS[domain]?.[a.action];
  if (!spec) return { status: 400, error: 'action_not_supported' };
  const sensitive = SENSITIVE_DOMAINS.has(domain);
  if (sensitive && !a.allowSensitive)
    return { status: 403, error: 'sensitive_device_not_allowed_here' };

  if ((await recentActs(env, c.now() - 60_000, false)) >= 12)
    return { status: 429, error: 'too_many_actions' };
  if (sensitive && (await recentActs(env, c.now() - 600_000, true)) >= 3)
    return { status: 429, error: 'too_many_sensitive_actions' };

  if (sensitive) {
    if (!a.confirmToken) {
      const token = newId();
      await env.DB.prepare(
        'INSERT INTO confirmations (token, entity_id, action, expires_at) VALUES (?,?,?,?)',
      )
        .bind(token, a.entityId, a.action, c.now() + 60_000)
        .run();
      return {
        needsConfirm: true,
        token,
        message: `Confirm: ${a.action} ${a.entityId}. This expires in 60 seconds.`,
      };
    }
    const row = await env.DB.prepare(
      'SELECT entity_id, action, expires_at, used FROM confirmations WHERE token = ?',
    )
      .bind(a.confirmToken)
      .first<{ entity_id: string; action: string; expires_at: number; used: number }>();
    if (
      !row ||
      row.used ||
      row.entity_id !== a.entityId ||
      row.action !== a.action ||
      row.expires_at < c.now()
    )
      return { status: 403, error: 'confirmation_invalid_or_expired' };
    await env.DB.prepare('UPDATE confirmations SET used = 1 WHERE token = ?')
      .bind(a.confirmToken)
      .run();
  }

  const data: Record<string, unknown> = { entity_id: a.entityId };
  if (a.action === 'set_temperature') {
    if (typeof a.value !== 'number' || a.value < 5 || a.value > 35)
      return { status: 400, error: 'temperature_must_be_5_to_35' };
    data.temperature = a.value;
  }
  try {
    await ha(env, c.fetchImpl, `/api/services/${domain}/${spec.service}`, {
      method: 'POST',
      body: data,
    });
  } catch (e) {
    await audit(
      env,
      a.source,
      'device.act',
      a.entityId,
      `failed: ${e instanceof Error ? e.message : 'error'}`,
    );
    return { status: 502, error: 'home_assistant_unreachable' };
  }
  await audit(env, a.source, 'device.act', a.entityId, `${a.action} ok`);
  return { ok: true };
}

interface SceneRow {
  id: string;
  name: string;
  steps: string;
  routine: string | null;
  routine_enabled: number;
}

export async function runScene(
  c: Pick<Ctx, 'env' | 'now' | 'fetchImpl'>,
  scene: SceneRow,
  source: AuditSource,
): Promise<{ ran: number; failed: string[] }> {
  const steps = JSON.parse(scene.steps) as { entityId: string; action: string; value?: number }[];
  const failed: string[] = [];
  let ran = 0;
  for (const s of steps) {
    const r = await executeAction(c, { ...s, source, allowSensitive: false });
    if (r.ok) ran++;
    else failed.push(`${s.entityId}: ${r.error}`);
  }
  await audit(c.env, source, 'scene.run', scene.name, `${ran} ok, ${failed.length} failed`);
  return { ran, failed };
}

/**
 * Routines are standing approvals you switch on yourself: a scene linked to "wind-down"
 * (30 minutes before suggested bedtime) or "wake" (15 minutes before wake-up). Each runs at most once a day.
 */
export async function runRoutines(c: Pick<Ctx, 'env' | 'now' | 'fetchImpl'>): Promise<number> {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, steps, routine, routine_enabled FROM scenes WHERE routine IS NOT NULL AND routine_enabled = 1',
  ).all<SceneRow>();
  if (!results?.length || !(await haConfig(c.env))) return 0;
  const s = await suggestionFor(c.env, c.now());
  let ran = 0;
  for (const scene of results) {
    const at = scene.routine === 'wind-down' ? s.bedtime - 30 * 60_000 : s.wake - 15 * 60_000;
    // Run inside a ten minute window after the trigger so a 15 minute cron cannot miss it by much.
    if (c.now() < at || c.now() > at + 10 * 60_000) continue;
    const key = `routine:${scene.id}:${localDateKey(at, s.timezone)}`;
    if (await getSetting(c.env, key)) continue;
    await setSetting(c.env, key, true);
    await runScene(c, scene, 'scheduler');
    ran++;
  }
  return ran;
}

/* --------------------------------- routes --------------------------------- */

export const home: Handler = async (c) => {
  const { env, path, method, req } = c;
  if (!path.startsWith('/api/home')) return null;

  if (path === '/api/home/config' && method === 'GET') {
    const cfg = await getSetting<HaConfig>(env, 'ha');
    return json({ configured: !!cfg, host: cfg?.host ?? null });
  }
  if (path === '/api/home/config' && method === 'PUT') {
    const b = await readJson(req);
    const url = typeof b?.url === 'string' ? normalizeHaUrl(b.url, env.LOCAL_DEV === '1') : null;
    const token =
      typeof b?.token === 'string' && b.token.length >= 20 && b.token.length <= 2000
        ? b.token.trim()
        : null;
    if (!url) return err(400, 'url_must_be_public_https');
    if (!token) return err(400, 'token_required');
    const trial: HaConfig = {
      urlEnc: await encrypt(url.origin + url.pathname, env.TOKEN_KEY),
      tokenEnc: await encrypt(token, env.TOKEN_KEY),
      host: url.host,
    };
    await setSetting(env, 'ha', trial);
    try {
      await ha(env, c.fetchImpl, '/api/');
    } catch {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'ha'").run();
      return err(502, 'could_not_connect_to_home_assistant');
    }
    await audit(env, 'user', 'home.connect', url.host, 'ok');
    return json({ configured: true, host: url.host });
  }
  if (path === '/api/home/config' && method === 'DELETE') {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'ha'").run();
    await audit(env, 'user', 'home.disconnect', 'home assistant', 'ok');
    return json({ ok: true });
  }

  if (path === '/api/home/entities' && method === 'GET') {
    try {
      const all = await states(env, c.fetchImpl);
      const allowed = new Set(
        (
          (await env.DB.prepare('SELECT entity_id FROM devices').all<{ entity_id: string }>())
            .results ?? []
        ).map((r) => r.entity_id),
      );
      return json({
        entities: all
          .filter((s) => SUPPORTED_DOMAINS.includes(domainOf(s.entity_id)))
          .slice(0, 300)
          .map((s) => ({
            entityId: s.entity_id,
            name: s.attributes?.friendly_name ?? s.entity_id,
            domain: domainOf(s.entity_id),
            sensitive: SENSITIVE_DOMAINS.has(domainOf(s.entity_id)),
            allowlisted: allowed.has(s.entity_id),
          })),
      });
    } catch (e) {
      return err(
        e instanceof Error && e.message === 'not_configured' ? 409 : 502,
        e instanceof Error ? e.message : 'error',
      );
    }
  }

  if (path === '/api/home/devices' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT entity_id, name FROM devices ORDER BY name',
    ).all<{ entity_id: string; name: string }>();
    let live = new Map<string, State>();
    try {
      live = new Map((await states(env, c.fetchImpl)).map((s) => [s.entity_id, s]));
    } catch {
      /* show the list even if Home Assistant is down */
    }
    return json({
      devices: (results ?? []).map((d) => ({
        entityId: d.entity_id,
        name: d.name,
        domain: domainOf(d.entity_id),
        sensitive: SENSITIVE_DOMAINS.has(domainOf(d.entity_id)),
        state: live.get(d.entity_id)?.state ?? null,
        actions: Object.keys(ACTIONS[domainOf(d.entity_id)] ?? {}),
      })),
    });
  }
  if (path === '/api/home/devices' && method === 'POST') {
    const b = await readJson(req);
    const entityId = typeof b?.entityId === 'string' ? b.entityId : '';
    if (!ENTITY.test(entityId) || !SUPPORTED_DOMAINS.includes(domainOf(entityId)))
      return err(400, 'unsupported_device');
    const name = str(b?.name, 60) ?? entityId;
    await env.DB.prepare(
      'INSERT INTO devices (entity_id, name) VALUES (?,?) ON CONFLICT(entity_id) DO UPDATE SET name = excluded.name',
    )
      .bind(entityId, name)
      .run();
    await audit(env, 'user', 'device.allowlist', entityId, 'added');
    return json({ ok: true }, 201);
  }
  const dd = /^\/api\/home\/devices\/([a-z_]+\.[a-z0-9_]+)$/.exec(path);
  if (dd && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM devices WHERE entity_id = ?').bind(dd[1]).run();
    await audit(env, 'user', 'device.allowlist', dd[1]!, 'removed');
    return json({ ok: true });
  }

  if (path === '/api/home/act' && method === 'POST') {
    const b = await readJson(req);
    const r = await executeAction(c, {
      entityId: typeof b?.entityId === 'string' ? b.entityId : '',
      action: typeof b?.action === 'string' ? b.action : '',
      value: typeof b?.value === 'number' ? b.value : undefined,
      confirmToken: typeof b?.confirmToken === 'string' ? b.confirmToken : undefined,
      source: 'user',
      allowSensitive: true,
    });
    return r.status ? err(r.status, r.error ?? 'error') : json(r);
  }

  if (path === '/api/home/scenes' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, steps, routine, routine_enabled FROM scenes ORDER BY name',
    ).all<SceneRow>();
    return json({
      scenes: (results ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        steps: JSON.parse(s.steps),
        routine: s.routine,
        routineEnabled: s.routine_enabled === 1,
      })),
    });
  }
  if (path === '/api/home/scenes' && method === 'POST') {
    const b = await readJson(req);
    const name = str(b?.name, 60);
    const raw = Array.isArray(b?.steps) ? (b!.steps as Record<string, unknown>[]) : null;
    const routine = b?.routine === 'wind-down' || b?.routine === 'wake' ? b.routine : null;
    if (!name || !raw?.length || raw.length > 20) return err(400, 'bad_scene');
    const steps: { entityId: string; action: string; value?: number }[] = [];
    for (const s of raw) {
      const entityId = typeof s.entityId === 'string' ? s.entityId : '';
      const action = typeof s.action === 'string' ? s.action : '';
      if (!ENTITY.test(entityId) || !ACTIONS[domainOf(entityId)]?.[action])
        return err(400, 'bad_scene_step');
      if (SENSITIVE_DOMAINS.has(domainOf(entityId)))
        return err(400, 'scenes_cannot_include_locks_covers_or_alarms');
      steps.push({ entityId, action, value: typeof s.value === 'number' ? s.value : undefined });
    }
    const id = newId();
    await env.DB.prepare(
      'INSERT INTO scenes (id, name, steps, routine, routine_enabled) VALUES (?,?,?,?,0)',
    )
      .bind(id, name, JSON.stringify(steps), routine)
      .run();
    return json({ id }, 201);
  }
  const sc = /^\/api\/home\/scenes\/([0-9a-f-]{36})(?:\/(run|routine))?$/.exec(path);
  if (sc) {
    const row = await env.DB.prepare(
      'SELECT id, name, steps, routine, routine_enabled FROM scenes WHERE id = ?',
    )
      .bind(sc[1])
      .first<SceneRow>();
    if (!row) return err(404, 'not_found');
    if (sc[2] === 'run' && method === 'POST') return json(await runScene(c, row, 'user'));
    if (sc[2] === 'routine' && method === 'POST') {
      const b = await readJson(req);
      if (typeof b?.enabled !== 'boolean') return err(400, 'enabled_required');
      if (b.enabled && !row.routine) return err(400, 'scene_has_no_routine');
      await env.DB.prepare('UPDATE scenes SET routine_enabled = ? WHERE id = ?')
        .bind(b.enabled ? 1 : 0, row.id)
        .run();
      await audit(
        env,
        'user',
        'routine.toggle',
        `${row.name} (${row.routine})`,
        b.enabled ? 'enabled' : 'disabled',
      );
      return json({ ok: true });
    }
    if (!sc[2] && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM scenes WHERE id = ?').bind(row.id).run();
      return json({ ok: true });
    }
  }
  return null;
};
