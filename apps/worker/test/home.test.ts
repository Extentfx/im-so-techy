import { describe, expect, it } from 'vitest';
import { runRoutines } from '../src/home';
import { harness, type Harness } from './helpers';

const TOKEN = 'ha-long-lived-token-abcdefghijklmnopqrstuvwxyz';
const HA = 'https://ha.example.com';

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
  redirect?: string;
}

/** A tiny Home Assistant: lists entities and records every service call. */
function fakeHa(opts: { down?: boolean } = {}) {
  const calls: Call[] = [];
  const f: typeof fetch = async (u, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(u),
      method: init?.method ?? 'GET',
      auth: headers.get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      redirect: init?.redirect,
    });
    if (opts.down) return new Response('down', { status: 503 });
    const path = new URL(String(u)).pathname;
    if (path === '/api/') return new Response(JSON.stringify({ message: 'API running.' }));
    if (path === '/api/states') {
      return new Response(
        JSON.stringify([
          { entity_id: 'light.lamp', state: 'off', attributes: { friendly_name: 'Desk lamp' } },
          {
            entity_id: 'lock.front_door',
            state: 'locked',
            attributes: { friendly_name: 'Front door' },
          },
          { entity_id: 'sensor.temp', state: '20', attributes: {} },
          { entity_id: 'climate.hall', state: 'heat', attributes: { friendly_name: 'Hall' } },
        ]),
      );
    }
    return new Response('[]');
  };
  return {
    f,
    calls,
    services: () => calls.filter((c) => c.method === 'POST').map((c) => c.url.replace(HA, '')),
  };
}

async function connected(extra = {}) {
  const h = harness({ ...extra });
  const ha = fakeHa();
  h.setFetch(ha.f);
  await h.json('PUT', '/api/profile', {
    completed: true,
    timezone: 'America/New_York',
    wakeTime: '06:30',
    sleepHours: 8,
  });
  const r = await h.json('PUT', '/api/home/config', { url: HA, token: TOKEN });
  expect(r._status).toBe(200);
  return { h, ha };
}

const allow = (h: Harness, entityId: string, name?: string) =>
  h.json('POST', '/api/home/devices', { entityId, name });

describe('connection', () => {
  it('stores the address and token encrypted, never returns them, and uses the token only as a bearer header', async () => {
    const { h, ha } = await connected();
    const cfg = await h.json<{ configured: boolean; host: string }>('GET', '/api/home/config');
    expect(cfg).toMatchObject({ configured: true, host: 'ha.example.com' });
    expect(JSON.stringify(cfg)).not.toContain(TOKEN);
    expect(JSON.stringify(h.raw.prepare('SELECT * FROM settings').all())).not.toContain(TOKEN);
    expect(JSON.stringify(h.raw.prepare('SELECT * FROM audit_log').all())).not.toContain(TOKEN);
    expect(ha.calls[0]).toMatchObject({
      url: `${HA}/api/`,
      auth: `Bearer ${TOKEN}`,
      redirect: 'manual',
    });
    await h.json('DELETE', '/api/home/config');
    expect((await h.json<{ configured: boolean }>('GET', '/api/home/config')).configured).toBe(
      false,
    );
  });

  it('rejects private or plain-http addresses outside local development and bad tokens', async () => {
    const h = harness();
    h.setFetch(fakeHa().f);
    for (const url of [
      'http://ha.example.com',
      'https://192.168.1.5:8123',
      'https://homeassistant.local:8123',
      'https://u:p@ha.example.com',
    ]) {
      expect((await h.json('PUT', '/api/home/config', { url, token: TOKEN }))._status).toBe(400);
    }
    expect((await h.json('PUT', '/api/home/config', { url: HA, token: 'short' }))._status).toBe(
      400,
    );
  });

  it('allows a plain-http address on your own network only in local development', async () => {
    const h = harness({ LOCAL_DEV: '1' });
    h.setFetch(fakeHa().f);
    expect(
      (
        await h.json('PUT', '/api/home/config', {
          url: 'http://homeassistant.local:8123',
          token: TOKEN,
        })
      )._status,
    ).toBe(200);
  });

  it('does not save the connection when Home Assistant is unreachable', async () => {
    const h = harness();
    h.setFetch(fakeHa({ down: true }).f);
    expect((await h.json('PUT', '/api/home/config', { url: HA, token: TOKEN }))._status).toBe(502);
    expect((await h.json<{ configured: boolean }>('GET', '/api/home/config')).configured).toBe(
      false,
    );
  });
});

describe('allowlist and actions', () => {
  it('lists candidates from Home Assistant but controls only allowlisted devices', async () => {
    const { h, ha } = await connected();
    const ents = (
      await h.json<{ entities: { entityId: string; allowlisted: boolean }[] }>(
        'GET',
        '/api/home/entities',
      )
    ).entities;
    expect(ents.map((e) => e.entityId).sort()).toEqual([
      'climate.hall',
      'light.lamp',
      'lock.front_door',
    ]); // sensors are not controllable
    expect(
      (await h.json('POST', '/api/home/act', { entityId: 'light.lamp', action: 'on' }))._status,
    ).toBe(403);
    expect(ha.services()).toEqual([]);

    expect((await allow(h, 'sensor.temp'))._status).toBe(400);
    await allow(h, 'light.lamp', 'Desk lamp');
    expect(
      (await h.json('POST', '/api/home/act', { entityId: 'light.lamp', action: 'on' }))._status,
    ).toBe(200);
    expect(ha.services()).toEqual(['/api/services/light/turn_on']);
    expect(ha.calls.at(-1)!.body).toEqual({ entity_id: 'light.lamp' });
    expect(
      (await h.json('POST', '/api/home/act', { entityId: 'light.lamp', action: 'explode' }))
        ._status,
    ).toBe(400);
    expect(
      (await h.json('POST', '/api/home/act', { entityId: '../../etc', action: 'on' }))._status,
    ).toBe(400);

    const devices = (
      await h.json<{ devices: { name: string; state: string; actions: string[] }[] }>(
        'GET',
        '/api/home/devices',
      )
    ).devices;
    expect(devices).toMatchObject([
      { name: 'Desk lamp', state: 'off', actions: ['on', 'off', 'toggle'] },
    ]);
    const audit = (
      await h.json<{ audit: { action: string; source: string }[] }>('GET', '/api/audit')
    ).audit;
    expect(audit.some((a) => a.action === 'device.act' && a.source === 'user')).toBe(true);
  });

  it('validates thermostat values', async () => {
    const { h, ha } = await connected();
    await allow(h, 'climate.hall');
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'climate.hall',
          action: 'set_temperature',
          value: 99,
        })
      )._status,
    ).toBe(400);
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'climate.hall',
          action: 'set_temperature',
          value: 21,
        })
      )._status,
    ).toBe(200);
    expect(ha.calls.at(-1)!.body).toEqual({ entity_id: 'climate.hall', temperature: 21 });
  });

  it('requires a single-use, expiring confirmation for locks', async () => {
    const { h, ha } = await connected();
    await allow(h, 'lock.front_door');
    const first = await h.json<{ needsConfirm: boolean; token: string }>('POST', '/api/home/act', {
      entityId: 'lock.front_door',
      action: 'unlock',
    });
    expect(first.needsConfirm).toBe(true);
    expect(ha.services()).toEqual([]); // nothing happened yet

    // wrong action or entity with that token is refused
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: 'lock',
          confirmToken: first.token,
        })
      )._status,
    ).toBe(403);
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: 'unlock',
          confirmToken: 'nope',
        })
      )._status,
    ).toBe(403);

    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: 'unlock',
          confirmToken: first.token,
        })
      )._status,
    ).toBe(200);
    expect(ha.services()).toEqual(['/api/services/lock/unlock']);
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: 'unlock',
          confirmToken: first.token,
        })
      )._status,
    ).toBe(403); // not reusable

    const second = await h.json<{ token: string }>('POST', '/api/home/act', {
      entityId: 'lock.front_door',
      action: 'lock',
    });
    h.setNow(Date.parse('2026-03-02T08:02:00Z')); // two minutes later
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: 'lock',
          confirmToken: second.token,
        })
      )._status,
    ).toBe(403); // expired
  });

  it('rate limits sensitive actions harder than ordinary ones', async () => {
    const { h } = await connected();
    await allow(h, 'lock.front_door');
    await allow(h, 'light.lamp');
    for (let i = 0; i < 3; i++) {
      const t = (
        await h.json<{ token: string }>('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: i % 2 ? 'lock' : 'unlock',
        })
      ).token;
      expect(
        (
          await h.json('POST', '/api/home/act', {
            entityId: 'lock.front_door',
            action: i % 2 ? 'lock' : 'unlock',
            confirmToken: t,
          })
        )._status,
      ).toBe(200);
    }
    expect(
      (
        await h.json('POST', '/api/home/act', {
          entityId: 'lock.front_door',
          action: 'unlock',
          confirmToken: 'x',
        })
      )._status,
    ).toBe(429);
    for (let i = 0; i < 9; i++)
      await h.json('POST', '/api/home/act', { entityId: 'light.lamp', action: 'toggle' });
    expect(
      (await h.json('POST', '/api/home/act', { entityId: 'light.lamp', action: 'toggle' }))._status,
    ).toBe(429);
  });

  it('reports an unreachable Home Assistant without leaking details, and audits the failure', async () => {
    const { h } = await connected();
    await allow(h, 'light.lamp');
    h.setFetch(fakeHa({ down: true }).f);
    const r = await h.json<{ error: string }>('POST', '/api/home/act', {
      entityId: 'light.lamp',
      action: 'on',
    });
    expect(r).toMatchObject({ _status: 502, error: 'home_assistant_unreachable' });
    expect(JSON.stringify(await h.json('GET', '/api/audit'))).toContain('failed');
  });
});

describe('scenes and routines', () => {
  it('runs scenes through the same policy, and refuses locks inside scenes', async () => {
    const { h, ha } = await connected();
    await allow(h, 'light.lamp');
    expect(
      (
        await h.json('POST', '/api/home/scenes', {
          name: 'Bad',
          steps: [{ entityId: 'lock.front_door', action: 'unlock' }],
        })
      )._status,
    ).toBe(400);
    expect(
      (
        await h.json('POST', '/api/home/scenes', {
          name: 'Bad',
          steps: [{ entityId: 'light.lamp', action: 'fly' }],
        })
      )._status,
    ).toBe(400);
    const { id } = await h.json<{ id: string }>('POST', '/api/home/scenes', {
      name: 'Movie',
      steps: [
        { entityId: 'light.lamp', action: 'off' },
        { entityId: 'light.hidden', action: 'off' },
      ],
    });
    const run = await h.json<{ ran: number; failed: string[] }>(
      'POST',
      `/api/home/scenes/${id}/run`,
    );
    expect(run.ran).toBe(1);
    expect(run.failed[0]).toMatch(/light.hidden: device_not_allowlisted/); // not allowlisted, skipped
    expect(ha.services()).toEqual(['/api/services/light/turn_off']);
  });

  it('runs the wind-down routine once, in its window, only when you enabled it, as the scheduler', async () => {
    const { h, ha } = await connected();
    await allow(h, 'light.lamp');
    const { id } = await h.json<{ id: string }>('POST', '/api/home/scenes', {
      name: 'Wind down',
      routine: 'wind-down',
      steps: [{ entityId: 'light.lamp', action: 'off' }],
    });
    const ctx = (ms: number) => ({ env: h.env, now: () => ms, fetchImpl: ha.f });
    // wake 06:30 EST, 8h sleep -> bed 22:30 EST on Mar 2 = 03:30Z Mar 3; routine 30 min earlier = 03:00Z
    const windDown = Date.parse('2026-03-03T03:00:00Z');

    expect(await runRoutines(ctx(windDown + 60_000))).toBe(0); // not enabled yet
    expect(
      (await h.json('POST', `/api/home/scenes/${id}/routine`, { enabled: true }))._status,
    ).toBe(200);
    expect(await runRoutines(ctx(windDown - 60_000))).toBe(0); // too early
    expect(await runRoutines(ctx(windDown + 120_000))).toBe(1);
    expect(await runRoutines(ctx(windDown + 300_000))).toBe(0); // already ran today
    expect(ha.services()).toEqual(['/api/services/light/turn_off']);
    const audit = (
      await h.json<{ audit: { action: string; source: string }[] }>('GET', '/api/audit')
    ).audit;
    expect(audit.filter((a) => a.action === 'device.act')[0]!.source).toBe('scheduler');

    // the next evening it runs again; but not outside the ten minute window
    const nextDay = windDown + 86_400_000;
    expect(await runRoutines(ctx(nextDay + 11 * 60_000))).toBe(0);
    expect(await runRoutines(ctx(nextDay + 60_000))).toBe(1);
    expect(
      (await h.json('POST', `/api/home/scenes/${id}/routine`, { enabled: 'yes' }))._status,
    ).toBe(400);
  });

  it('cannot enable a routine on a scene that has none', async () => {
    const { h } = await connected();
    await allow(h, 'light.lamp');
    const { id } = await h.json<{ id: string }>('POST', '/api/home/scenes', {
      name: 'Plain',
      steps: [{ entityId: 'light.lamp', action: 'on' }],
    });
    expect(
      (await h.json('POST', `/api/home/scenes/${id}/routine`, { enabled: true }))._status,
    ).toBe(400);
  });
});
