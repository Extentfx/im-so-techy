import type { ShiftChange } from '@life/shared';

export interface Comparable {
  key: string;
  title: string;
  start: string;
  end: string;
}

export type Change = Omit<ShiftChange, 'id' | 'sourceName' | 'at'>;

const day = (iso: string) => iso.slice(0, 10);

/**
 * Compare two snapshots of a work calendar.
 * - same key, different times  -> changed
 * - key gone / key new         -> removed / added
 * - a removed and an added event with the same title on the same day are treated as one "changed"
 *   (rosters often regenerate IDs when a shift is edited).
 */
export function diffEvents(before: Comparable[], after: Comparable[]): Change[] {
  const b = new Map(before.map((e) => [e.key, e]));
  const a = new Map(after.map((e) => [e.key, e]));
  const changes: Change[] = [];
  const removed: Comparable[] = [];
  const added: Comparable[] = [];

  for (const [key, old] of b) {
    const now = a.get(key);
    if (!now) removed.push(old);
    else if (now.start !== old.start || now.end !== old.end) {
      changes.push({
        type: 'changed',
        title: now.title,
        old: { start: old.start, end: old.end },
        new: { start: now.start, end: now.end },
      });
    }
  }
  for (const [key, now] of a) if (!b.has(key)) added.push(now);

  for (const r of [...removed]) {
    const i = added.findIndex(
      (x) => x.title.toLowerCase() === r.title.toLowerCase() && day(x.start) === day(r.start),
    );
    if (i >= 0) {
      const x = added.splice(i, 1)[0]!;
      removed.splice(removed.indexOf(r), 1);
      if (x.start !== r.start || x.end !== r.end) {
        changes.push({
          type: 'changed',
          title: x.title,
          old: { start: r.start, end: r.end },
          new: { start: x.start, end: x.end },
        });
      }
    }
  }
  for (const r of removed)
    changes.push({
      type: 'removed',
      title: r.title,
      old: { start: r.start, end: r.end },
      new: null,
    });
  for (const x of added)
    changes.push({ type: 'added', title: x.title, old: null, new: { start: x.start, end: x.end } });
  return changes;
}
