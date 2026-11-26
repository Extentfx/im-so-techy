import { describe, expect, it } from 'vitest';
import { harness } from './helpers';

describe('profile, proposals and the Dashboard calendar', () => {
  it('stores a sanitized profile server-side', async () => {
    const h = harness();
    expect((await h.json<{ exists: boolean }>('GET', '/api/profile')).exists).toBe(false);
    const r = await h.json<{
      profile: { name: string; calorieTarget: number | null; units: string };
    }>('PUT', '/api/profile', {
      completed: true,
      name: ' Sam ',
      calorieTarget: 99999,
      units: 'stone',
    });
    expect(r.profile).toMatchObject({ name: 'Sam', calorieTarget: 6000, units: 'lb' });
    expect((await h.json<{ exists: boolean }>('GET', '/api/profile')).exists).toBe(true);
  });

  it('writes to the Dashboard calendar only after a proposal is approved, and audits it', async () => {
    const h = harness();
    const created = await h.json<{ id: string }>('POST', '/api/proposals', {
      source: 'scheduler',
      kind: 'calendar_event',
      summary: 'Gym',
      payload: { title: 'Gym session', start: '2026-03-03T22:00:00Z', end: '2026-03-03T23:00:00Z' },
    });
    expect(created._status).toBe(201);
    const range = '/api/events?from=2026-03-03T00:00:00Z&to=2026-03-04T00:00:00Z';
    expect((await h.json<{ events: unknown[] }>('GET', range)).events).toHaveLength(0); // still only a proposal

    expect((await h.json('POST', `/api/proposals/${created.id}/approve`))._status).toBe(200);
    const { events } = await h.json<{ events: { title: string; kind: string }[] }>('GET', range);
    expect(events).toMatchObject([{ title: 'Gym session', kind: 'dashboard' }]);
    expect((await h.json('POST', `/api/proposals/${created.id}/approve`))._status).toBe(409); // not twice
    const { audit } = await h.json<{ audit: { source: string; action: string }[] }>(
      'GET',
      '/api/audit',
    );
    expect(audit[0]).toMatchObject({ source: 'scheduler', action: 'calendar.write' });
  });

  it('rejects bad proposals and lets a rejected one stay out of the calendar', async () => {
    const h = harness();
    expect(
      (
        await h.json('POST', '/api/proposals', {
          kind: 'calendar_event',
          payload: { title: 'x', start: 'bad', end: 'bad' },
        })
      )._status,
    ).toBe(400);
    expect(
      (
        await h.json('POST', '/api/proposals', {
          kind: 'calendar_event',
          payload: { title: 'x', start: '2026-03-03T10:00:00Z', end: '2026-03-03T09:00:00Z' },
        })
      )._status,
    ).toBe(400);
    const { id } = await h.json<{ id: string }>('POST', '/api/proposals', {
      kind: 'calendar_event',
      payload: { title: 'Nope', start: '2026-03-03T10:00:00Z', end: '2026-03-03T11:00:00Z' },
    });
    await h.json('POST', `/api/proposals/${id}/reject`);
    expect(
      (
        await h.json<{ events: unknown[] }>(
          'GET',
          '/api/events?from=2026-03-03T00:00:00Z&to=2026-03-04T00:00:00Z',
        )
      ).events,
    ).toHaveLength(0);
    expect(
      (await h.json<{ proposals: unknown[] }>('GET', '/api/proposals')).proposals,
    ).toHaveLength(0);
  });
});
