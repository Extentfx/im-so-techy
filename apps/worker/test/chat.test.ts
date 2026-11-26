import { describe, expect, it } from 'vitest';
import { harness, NOW, type Harness } from './helpers';

const ics = (events: string[]) => `BEGIN:VCALENDAR\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;

async function ask(h: Harness, content: string, history: { role: string; content: string }[] = []) {
  const r = await h.call('POST', '/api/chat', {
    messages: [...history, { role: 'user', content }],
  });
  const text = await r.text();
  const events = text
    .split('\n\n')
    .filter((x) => x.startsWith('data: '))
    .map((x) => JSON.parse(x.slice(6)) as Record<string, unknown>);
  return {
    status: r.status,
    events,
    text: events
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
  };
}

async function setup(extraEnv = {}) {
  const h = harness(extraEnv);
  await h.json('PUT', '/api/profile', {
    completed: true,
    timezone: 'America/New_York',
    name: 'Sam',
    proteinTarget: 150,
    calorieTarget: 2200,
  });
  return h;
}

/** A fake Anthropic streaming response built from [event, data] pairs. */
const claude = (events: [string, unknown][]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const [e, d] of events)
          c.enqueue(new TextEncoder().encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
const textTurn = (text: string, out = 20) =>
  claude([
    ['message_start', { message: { usage: { input_tokens: 100, cache_read_input_tokens: 50 } } }],
    ['content_block_start', { index: 0, content_block: { type: 'text' } }],
    ['content_block_delta', { index: 0, delta: { type: 'text_delta', text } }],
    ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: out } }],
  ]);
const toolTurn = (name: string, input: unknown) =>
  claude([
    ['message_start', { message: { usage: { input_tokens: 200 } } }],
    ['content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tu_1', name } }],
    [
      'content_block_delta',
      {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 5) },
      },
    ],
    [
      'content_block_delta',
      {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(5) },
      },
    ],
    ['message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }],
  ]);

describe('chat without Claude (built-in answers from real data)', () => {
  it('answers "Can I fit legs tomorrow?" from the scheduler, rest days and shifts', async () => {
    const h = await setup();
    // trained legs yesterday (Sun Mar 1) -> only 1 rest day by Tuesday... leg recovery needs 2
    await h.json('POST', '/api/workouts', {
      startedAt: '2026-03-01T22:00:00Z',
      endedAt: '2026-03-01T23:00:00Z',
      sets: [{ exerciseId: 'back-squat', reps: 5, weightKg: 100 }],
    });
    const r = await ask(h, 'Can I fit legs tomorrow?');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Best window/);
    expect(r.text).toMatch(/legs/i);
    expect(r.text).toMatch(/2 days|may be early/);
    expect(r.events.some((e) => e.type === 'suggest')).toBe(true);
  });

  it('says no on a day with a long shift', async () => {
    const h = await setup();
    h.setFeed(
      ics([
        'BEGIN:VEVENT\r\nUID:l\r\nDTSTART:20260303T110000Z\r\nDTEND:20260303T230000Z\r\nSUMMARY:Long shift\r\nEND:VEVENT',
      ]),
    );
    await h.json('POST', '/api/sources', {
      name: 'Work',
      kind: 'work',
      url: 'https://cal.example.com/w.ics',
    });
    const r = await ask(h, 'Can I fit legs tomorrow?');
    expect(r.text).toMatch(/^Probably not tomorrow: you have a shift longer than 10 hours/);
    expect(r.events.some((e) => e.type === 'suggest')).toBe(false);
  });

  it('answers protein, schedule, sleep, email and workout questions with real numbers', async () => {
    const h = await setup();
    await h.json('POST', '/api/food/log', {
      date: '2026-03-02',
      slot: 'lunch',
      name: 'Chicken',
      kcal: 500,
      protein: 60,
    });
    expect((await ask(h, 'Am I under on protein today?')).text).toMatch(
      /60 g protein.*90 g under your 150 g/,
    );
    await h.json('POST', '/api/proposals', {
      kind: 'calendar_event',
      payload: { title: 'Dentist', start: '2026-03-02T19:00:00Z', end: '2026-03-02T20:00:00Z' },
    });
    h.setFeed(
      ics([
        'BEGIN:VEVENT\r\nUID:s\r\nDTSTART:20260302T130000Z\r\nDTEND:20260302T140000Z\r\nSUMMARY:School assembly\r\nEND:VEVENT',
      ]),
    );
    await h.json('POST', '/api/sources', {
      name: 'School',
      kind: 'school',
      url: 'https://cal.example.com/s.ics',
    });
    expect((await ask(h, "What's on today?")).text).toMatch(
      /School assembly \(Mon, Mar 2, 8:00 AM to 9:00 AM\)/,
    );
    expect((await ask(h, 'How did I sleep?')).text).toMatch(/No sleep logged yet/);
    await h.json('POST', '/api/email/ingest', {
      from: 'office@lincoln.k12.ny.us',
      subject: 'Picture day moved',
      body: 'Picture day moved to March 18.',
    });
    expect((await ask(h, 'What did my school email change this week?')).text).toMatch(
      /Picture day moved/,
    );
    expect((await ask(h, 'What was my last workout?')).text).toMatch(/No workouts logged/);
    expect((await ask(h, 'tell me a joke')).text).toMatch(/Can I fit legs tomorrow/);
  });

  it('validates the conversation and never stores it', async () => {
    const h = await setup();
    expect((await h.call('POST', '/api/chat', {})).status).toBe(400);
    expect(
      (await h.call('POST', '/api/chat', { messages: [{ role: 'assistant', content: 'hi' }] }))
        .status,
    ).toBe(400);
    expect(
      (await h.call('POST', '/api/chat', { messages: [{ role: 'system', content: 'x' }] })).status,
    ).toBe(400);
    await ask(h, 'my secret password is hunter2');
    const dump =
      JSON.stringify(h.raw.prepare('SELECT * FROM chat_usage').all()) +
      JSON.stringify(h.raw.prepare('SELECT * FROM audit_log').all());
    expect(dump).not.toContain('hunter2');
  });
});

describe('chat with Claude (faked stream)', () => {
  it('streams text, runs a read-only tool, caches the stable prompt, and records spend', async () => {
    const h = await setup({ ANTHROPIC_API_KEY: 'k' });
    const bodies: Record<string, unknown>[] = [];
    let n = 0;
    h.setFetch(async (_u, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return ++n === 1 ? toolTurn('get_sleep', {}) : textTurn('You slept fine.');
    });
    const r = await ask(h, 'How was my sleep?');
    expect(r.text).toBe('You slept fine.');
    expect(r.events.filter((e) => e.type === 'tool')).toEqual([
      { type: 'tool', name: 'get_sleep' },
    ]);
    expect(n).toBe(2);

    const first = bodies[0]!;
    expect(first.stream).toBe(true);
    expect((first.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({
      type: 'ephemeral',
    });
    const toolNames = (first.tools as { name: string }[]).map((t) => t.name);
    expect(toolNames).toContain('propose_event');
    expect(toolNames.some((t) => /delete|remove|write|run_scene|set_/.test(t))).toBe(false); // read-only plus a proposal tool
    const second = bodies[1]!.messages as { role: string; content: unknown }[];
    expect(second.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1' }],
    });

    const status = await h.json<{ spentUsd: number; claude: boolean }>('GET', '/api/chat/status');
    expect(status.claude).toBe(true);
    expect(status.spentUsd).toBeGreaterThan(0);
    expect(status.spentUsd).toBeLessThan(0.01);
  });

  it('turns propose_event into a pending proposal only, never a calendar entry', async () => {
    const h = await setup({ ANTHROPIC_API_KEY: 'k' });
    let n = 0;
    h.setFetch(async () =>
      ++n === 1
        ? toolTurn('propose_event', {
            title: 'Leg day',
            start: '2026-03-04T22:00:00Z',
            end: '2026-03-04T23:00:00Z',
          })
        : textTurn('I suggested it; approve it to add it.'),
    );
    const r = await ask(h, 'Add leg day Wednesday evening');
    expect(r.events.find((e) => e.type === 'proposal')).toMatchObject({ title: 'Leg day' });
    const props = (
      await h.json<{ proposals: { source: string; status: string }[] }>('GET', '/api/proposals')
    ).proposals;
    expect(props).toMatchObject([{ source: 'chat', status: 'pending' }]);
    expect(
      (
        await h.json<{ events: unknown[] }>(
          'GET',
          '/api/events?from=2026-03-01T00:00:00Z&to=2026-03-10T00:00:00Z',
        )
      ).events,
    ).toHaveLength(0);
  });

  it('refuses unknown tools and bad tool input without side effects', async () => {
    const h = await setup({ ANTHROPIC_API_KEY: 'k' });
    let n = 0;
    h.setFetch(async () =>
      ++n === 1
        ? toolTurn('delete_everything', { all: true })
        : n === 2
          ? toolTurn('propose_event', { title: '', start: 'x', end: 'y' })
          : textTurn('done'),
    );
    const before = JSON.stringify(h.raw.prepare('SELECT COUNT(*) n FROM proposals').get());
    const r = await ask(h, 'wipe it all');
    expect(r.text).toBe('done');
    expect(JSON.stringify(h.raw.prepare('SELECT COUNT(*) n FROM proposals').get())).toBe(before);
  });

  it('stops at the daily cap and falls back to built-in answers without calling Claude', async () => {
    const h = await setup({ ANTHROPIC_API_KEY: 'k', CHAT_DAILY_CAP_USD: '0.0001' });
    let calls = 0;
    h.setFetch(async () => (calls++, textTurn('x', 500)));
    await ask(h, 'hello'); // spends past the tiny cap
    const second = await ask(h, 'How did I sleep?');
    expect(second.text).toMatch(/spending limit/);
    expect(second.text).toMatch(/No sleep logged yet/);
    expect(calls).toBe(1);
  });

  it('shows a friendly error when Claude is unavailable', async () => {
    const h = await setup({ ANTHROPIC_API_KEY: 'k' });
    h.setFetch(async () => new Response('overloaded', { status: 529 }));
    const r = await ask(h, 'hi');
    expect(r.events.find((e) => e.type === 'error')).toBeTruthy();
    expect(JSON.stringify(r.events)).not.toContain('529');
    void NOW;
  });
});
