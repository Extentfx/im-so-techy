import { describe, expect, it } from 'vitest';
import { diffEvents, type Comparable } from './diff';

const e = (key: string, title: string, start: string, end: string): Comparable => ({
  key,
  title,
  start,
  end,
});
const mon = e('s1', 'Shift', '2026-03-02T13:00:00Z', '2026-03-02T21:00:00Z');
const tue = e('s2', 'Shift', '2026-03-03T13:00:00Z', '2026-03-03T21:00:00Z');

describe('diffEvents', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffEvents([mon, tue], [mon, tue])).toEqual([]);
  });
  it('detects a time change on the same key', () => {
    const moved = { ...mon, start: '2026-03-02T15:00:00Z', end: '2026-03-02T23:00:00Z' };
    expect(diffEvents([mon, tue], [moved, tue])).toEqual([
      {
        type: 'changed',
        title: 'Shift',
        old: { start: mon.start, end: mon.end },
        new: { start: moved.start, end: moved.end },
      },
    ]);
  });
  it('detects added and removed shifts', () => {
    expect(diffEvents([mon], [mon, tue]).map((c) => c.type)).toEqual(['added']);
    expect(diffEvents([mon, tue], [mon]).map((c) => c.type)).toEqual(['removed']);
  });
  it('pairs a regenerated-ID shift on the same day as one change', () => {
    const regenerated = e('new-id', 'Shift', '2026-03-02T15:00:00Z', '2026-03-02T23:00:00Z');
    const out = diffEvents([mon], [regenerated]);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('changed');
  });
  it('does not pair different titles or days', () => {
    const other = e('x', 'Training', '2026-03-02T15:00:00Z', '2026-03-02T16:00:00Z');
    expect(
      diffEvents([mon], [other])
        .map((c) => c.type)
        .sort(),
    ).toEqual(['added', 'removed']);
    const nextDay = e('y', 'Shift', '2026-03-04T13:00:00Z', '2026-03-04T21:00:00Z');
    expect(
      diffEvents([mon], [nextDay])
        .map((c) => c.type)
        .sort(),
    ).toEqual(['added', 'removed']);
  });
});
