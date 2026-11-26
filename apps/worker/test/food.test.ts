import { describe, expect, it } from 'vitest';
import { harness } from './helpers';

const D = '2026-03-02'; // Monday

describe('calorie tracker', () => {
  it('logs food with quantity, totals it, and compares to targets from the profile', async () => {
    const h = harness();
    await h.json('PUT', '/api/profile', {
      completed: true,
      calorieTarget: 2200,
      proteinTarget: 150,
    });
    const a = await h.json<{ id: string }>('POST', '/api/food/log', {
      date: D,
      slot: 'breakfast',
      name: 'Oats',
      kcal: 150,
      protein: 5,
      carbs: 27,
      fat: 3,
      qty: 2,
    });
    await h.json('POST', '/api/food/log', {
      date: D,
      slot: 'dinner',
      name: 'Chicken',
      kcal: 300,
      protein: 40,
    });
    const r = await h.json<{
      totals: { kcal: number; protein: number };
      targets: { kcal: number; protein: number };
      entries: { name: string; kcal: number }[];
    }>('GET', `/api/food/log?date=${D}`);
    expect(r.totals).toMatchObject({ kcal: 600, protein: 50 });
    expect(r.targets).toEqual({ kcal: 2200, protein: 150 });
    expect(r.entries[0]).toMatchObject({ name: 'Oats', kcal: 300 });
    await h.json('DELETE', `/api/food/log/${a.id}`);
    expect(
      (await h.json<{ totals: { kcal: number } }>('GET', `/api/food/log?date=${D}`)).totals.kcal,
    ).toBe(300);
  });

  it('rejects malformed entries', async () => {
    const h = harness();
    for (const bad of [
      { date: 'x', slot: 'lunch', name: 'a', kcal: 1 },
      { date: D, slot: 'brunch', name: 'a', kcal: 1 },
      { date: D, slot: 'lunch', name: '', kcal: 1 },
      { date: D, slot: 'lunch', name: 'a', kcal: -5 },
      { date: D, slot: 'lunch', name: 'a', kcal: 99999 },
      { date: D, slot: 'lunch', name: 'a', kcal: 5, qty: 0 },
    ])
      expect((await h.json('POST', '/api/food/log', bad))._status).toBe(400);
  });

  it('saves foods and meals and re-logs a meal', async () => {
    const h = harness();
    await h.json('POST', '/api/foods', {
      name: 'Protein shake',
      kcal: 160,
      protein: 30,
      barcode: '12345678',
    });
    expect(
      (await h.json<{ saved: { name: string }[] }>('GET', '/api/food/search?q=shake')).saved[0]
        ?.name,
    ).toBe('Protein shake');
    expect(
      (await h.json<{ food: { source: string } }>('GET', '/api/food/barcode/12345678')).food.source,
    ).toBe('saved');
    const m = await h.json<{ id: string }>('POST', '/api/meals', {
      name: 'Usual breakfast',
      items: [
        { name: 'Oats', kcal: 150, protein: 5 },
        { name: 'Banana', kcal: 100, qty: 2 },
      ],
    });
    const log = await h.json<{ count: number }>('POST', `/api/meals/${m.id}/log`, {
      date: D,
      slot: 'breakfast',
    });
    expect(log.count).toBe(2);
    expect(
      (await h.json<{ totals: { kcal: number } }>('GET', `/api/food/log?date=${D}`)).totals.kcal,
    ).toBe(350);
  });

  it('searches outside databases through the Worker with an injected fetch, and reports barcode misses', async () => {
    const h = harness();
    h.setFetch(
      async (u) =>
        new Response(
          JSON.stringify(
            String(u).includes('openfoodfacts')
              ? {
                  products: [
                    {
                      product_name: 'Peanut butter',
                      nutriments: { 'energy-kcal_100g': 600, proteins_100g: 25 },
                    },
                  ],
                  status: 0,
                }
              : { foods: [] },
          ),
        ),
    );
    const r = await h.json<{ results: { name: string }[] }>('GET', '/api/food/search?q=peanut');
    expect(r.results[0]?.name).toBe('Peanut butter');
    expect((await h.json('GET', '/api/food/search?q=a'))._status).toBe(400);
    expect((await h.json('GET', '/api/food/barcode/99999999'))._status).toBe(404);
  });

  it('runs the school-lunch flow: weekday rule, one-tap confirm, no duplicates', async () => {
    const h = harness();
    await h.json('PUT', '/api/profile', { completed: true, lunchFor: 'me' });
    await h.json('PUT', '/api/lunch/rules', {
      rules: [
        { weekday: 1, name: 'Pizza', kcal: 420, protein: 18, carbs: 50, fat: 15 },
        { weekday: 2, name: 'Pasta', kcal: 480 },
      ],
    });
    const t = await h.json<{ rule: { name: string }; status: string | null }>(
      'GET',
      `/api/lunch/today?date=${D}`,
    );
    expect(t.rule.name).toBe('Pizza'); // 2026-03-02 is a Monday
    expect(t.status).toBeNull();
    await h.json('POST', '/api/lunch/confirm', { date: D, action: 'ate' });
    await h.json('POST', '/api/lunch/confirm', { date: D, action: 'ate' });
    expect(
      (
        await h.json<{ totals: { kcal: number }; entries: unknown[] }>(
          'GET',
          `/api/food/log?date=${D}`,
        )
      ).totals.kcal,
    ).toBe(420);
    await h.json('POST', '/api/lunch/confirm', { date: D, action: 'skipped' });
    const after = await h.json<{ entries: unknown[] }>('GET', `/api/food/log?date=${D}`);
    expect(after.entries).toHaveLength(0); // changing your mind removes the auto entry
    expect((await h.json<{ status: string }>('GET', `/api/lunch/today?date=${D}`)).status).toBe(
      'skipped',
    );
    await h.json('POST', '/api/lunch/confirm', {
      date: D,
      action: 'other',
      name: 'Sandwich',
      kcal: 350,
      protein: 20,
    });
    expect(
      (await h.json<{ totals: { kcal: number } }>('GET', `/api/food/log?date=${D}`)).totals.kcal,
    ).toBe(350);
    expect(
      (await h.json('POST', '/api/lunch/confirm', { date: '2026-03-06', action: 'ate' }))._status,
    ).toBe(404); // no Friday rule
  });

  it("tracks a kid's lunch without adding their calories to your log, and is off when disabled", async () => {
    const h = harness();
    await h.json('PUT', '/api/profile', { completed: true, lunchFor: 'kids' });
    await h.json('PUT', '/api/lunch/rules', { rules: [{ weekday: 1, name: 'Pizza', kcal: 420 }] });
    await h.json('POST', '/api/lunch/confirm', { date: D, action: 'ate' });
    expect(
      (await h.json<{ entries: unknown[] }>('GET', `/api/food/log?date=${D}`)).entries,
    ).toHaveLength(0);
    await h.json('PUT', '/api/profile', { completed: true, lunchFor: 'none' });
    expect((await h.json<{ enabled: boolean }>('GET', `/api/lunch/today?date=${D}`)).enabled).toBe(
      false,
    );
  });
});
