import { useEffect, useMemo, useState } from 'react';
import type { CalEvent } from '@life/shared';
import { getFamilyView, type FamilyView } from '../lib/adminApi';
import { addDays, dayKey, groupByDay } from '../lib/week';
import { EventRow } from '../components/EventRow';

/** The read-only page behind a family link. No login, no controls, nothing but this week's events. */
export function Family() {
  const [view, setView] = useState<FamilyView | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('t') ?? '';
    getFamilyView(token).then(setView, () => setGone(true));
  }, []);

  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, []);
  const events: CalEvent[] = useMemo(
    () =>
      (view?.events ?? []).map((e, i) => ({
        id: String(i),
        sourceId: 'family',
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: null,
        kind: e.kind,
      })),
    [view],
  );
  const byDay = useMemo(() => groupByDay(events, days), [events, days]);

  if (gone) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-4xl">This link has expired</h1>
        <p className="mt-3 text-[var(--ink-soft)]">Ask the person who shared it for a new one.</p>
      </main>
    );
  }
  if (!view) return null;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-5xl italic leading-tight">{view.name}</h1>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Read-only. This link stops working on {new Date(view.expiresAt).toLocaleDateString()}.
      </p>
      <div className="mt-6 grid gap-3">
        {days.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          return (
            <section
              key={dayKey(d)}
              aria-label={d.toDateString()}
              className="glass rounded-3xl p-4"
            >
              <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
                {d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
              </h2>
              {list.length ? (
                <ul className="mt-3 grid gap-3">
                  {list.map((e) => (
                    <EventRow key={`${e.id}-${dayKey(d)}`} e={e} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--ink-soft)]">Nothing scheduled</p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
