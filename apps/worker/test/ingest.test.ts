import { describe, expect, it } from 'vitest';
import { handleApi } from '../src/api';
import { allHandlers } from '../src/modules';
import { harness } from './helpers';

describe('Shortcut ingest (service token, no browser headers)', () => {
  const post = (h: ReturnType<typeof harness>, path: string, headers: Record<string, string>) =>
    handleApi(
      new Request(`https://life.example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ bedAt: '2026-03-01T04:00:00Z', wakeAt: '2026-03-01T11:30:00Z' }),
      }),
      h.env,
      undefined,
      () => Date.parse('2026-03-02T08:00:00Z'),
      undefined,
      allHandlers,
    );

  it('accepts a Shortcut that carries Access service-token headers', async () => {
    const h = harness();
    expect(
      (await post(h, '/api/ingest/sleep', { 'cf-access-client-id': 'abc.access' })).status,
    ).toBe(201);
  });
  it('still rejects a header-less cross-site style request to the same route', async () => {
    const h = harness();
    expect((await post(h, '/api/ingest/sleep', {})).status).toBe(403);
    expect((await post(h, '/api/ingest/sleep', { 'sec-fetch-site': 'cross-site' })).status).toBe(
      403,
    );
  });
  it('does not extend that exemption to any other write route', async () => {
    const h = harness();
    expect((await post(h, '/api/sleep', { 'cf-access-client-id': 'abc.access' })).status).toBe(403);
    expect((await post(h, '/api/admin/kill', { 'cf-access-client-id': 'abc.access' })).status).toBe(
      403,
    );
  });
});
