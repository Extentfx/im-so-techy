import { describe, expect, it } from 'vitest';
import { harness } from './helpers';

const iso = '2026-03-02T18:00:00Z';
const done = '2026-03-02T19:00:00Z';

describe('gym tracker', () => {
  it('logs a workout, flags PRs against earlier history, and never in the first session', async () => {
    const h = harness();
    const first = await h.json<{ prs: unknown[] }>('POST', '/api/workouts', {
      startedAt: iso,
      endedAt: done,
      sets: [{ exerciseId: 'bench-press', reps: 5, weightKg: 100 }],
    });
    expect(first._status).toBe(201);
    expect(first.prs).toEqual([]);

    const second = await h.json<{ prs: { exerciseId: string; kind: string; name: string }[] }>(
      'POST',
      '/api/workouts',
      {
        startedAt: '2026-03-09T18:00:00Z',
        endedAt: '2026-03-09T19:00:00Z',
        sets: [
          { exerciseId: 'bench-press', reps: 5, weightKg: 102.5 },
          { exerciseId: 'squat-not-real', reps: 5, weightKg: 100 },
        ],
      },
    );
    expect(second._status).toBe(400); // unknown exercise is rejected whole

    const ok = await h.json<{ prs: { exerciseId: string; kind: string; name: string }[] }>(
      'POST',
      '/api/workouts',
      {
        startedAt: '2026-03-09T18:00:00Z',
        endedAt: '2026-03-09T19:00:00Z',
        sets: [
          { exerciseId: 'bench-press', reps: 5, weightKg: 102.5 },
          { exerciseId: 'back-squat', reps: 5, weightKg: 140 },
        ],
      },
    );
    expect(ok.prs).toMatchObject([
      { exerciseId: 'bench-press', kind: 'e1rm', name: 'Bench press' },
    ]);

    const { workouts } = await h.json<{
      workouts: { startedAt: string; sets: { pr: string | null }[] }[];
    }>('GET', '/api/workouts');
    expect(workouts.map((w) => w.startedAt)).toEqual(['2026-03-09T18:00:00Z', iso]); // newest first
    expect(workouts[0]!.sets[0]!.pr).toBe('e1rm');
  });

  it('validates input and suggests progressive overload from the last session', async () => {
    const h = harness();
    expect(
      (await h.json('POST', '/api/workouts', { startedAt: iso, endedAt: done, sets: [] }))._status,
    ).toBe(400);
    expect(
      (
        await h.json('POST', '/api/workouts', {
          startedAt: 'x',
          endedAt: done,
          sets: [{ exerciseId: 'deadlift', reps: 5, weightKg: 100 }],
        })
      )._status,
    ).toBe(400);
    expect(
      (
        await h.json('POST', '/api/workouts', {
          startedAt: iso,
          endedAt: done,
          sets: [{ exerciseId: 'deadlift', reps: 5, weightKg: -5 }],
        })
      )._status,
    ).toBe(400);

    await h.json('POST', '/api/workouts', {
      startedAt: iso,
      endedAt: done,
      sets: [
        { exerciseId: 'dumbbell-curl', reps: 12, weightKg: 15 },
        { exerciseId: 'dumbbell-curl', reps: 12, weightKg: 15 },
      ],
    });
    const s = await h.json<{ suggestion: { weightKg: number; reps: number } }>(
      'GET',
      '/api/gym/suggest?exerciseId=dumbbell-curl',
    );
    expect(s.suggestion).toMatchObject({ weightKg: 17.5, reps: 8 });
    expect(
      (await h.json<{ suggestion: unknown }>('GET', '/api/gym/suggest?exerciseId=deadlift'))
        .suggestion,
    ).toBeNull();
  });

  it('saves templates (with exercise validation) and bodyweight (one entry per day)', async () => {
    const h = harness();
    expect(
      (
        await h.json('POST', '/api/templates', {
          name: 'Push',
          items: [{ exerciseId: 'nope', sets: 3, reps: 8 }],
        })
      )._status,
    ).toBe(400);
    const t = await h.json<{ id: string }>('POST', '/api/templates', {
      name: 'Push',
      items: [
        { exerciseId: 'bench-press', sets: 3, reps: 8 },
        { exerciseId: 'overhead-press', sets: 3, reps: 10 },
      ],
    });
    expect(t._status).toBe(201);
    expect(
      (await h.json<{ templates: { name: string; items: unknown[] }[] }>('GET', '/api/templates'))
        .templates,
    ).toMatchObject([{ name: 'Push', items: [{}, {}] }]);
    await h.json('DELETE', `/api/templates/${t.id}`);
    expect(
      (await h.json<{ templates: unknown[] }>('GET', '/api/templates')).templates,
    ).toHaveLength(0);

    await h.json('POST', '/api/bodyweight', { date: '2026-03-02', kg: 82.5 });
    await h.json('POST', '/api/bodyweight', { date: '2026-03-02', kg: 82.1 });
    expect((await h.json('POST', '/api/bodyweight', { date: '2026-03-02', kg: 5 }))._status).toBe(
      400,
    );
    expect((await h.json<{ entries: { kg: number }[] }>('GET', '/api/bodyweight')).entries).toEqual(
      [{ date: '2026-03-02', kg: 82.1 }],
    );
  });
});
