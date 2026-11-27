import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalEvent, CalendarSource, ShiftChange } from '@life/shared';
import { ackAlert, friendly, getAlerts, getEvents, getSources } from '../lib/api';
import {
  addDays,
  dayKey,
  groupByDay,
  KIND_COLOR,
  KIND_LABEL,
  mondayOf,
  rangeOf,
} from '../lib/week';
import { EventRow } from '../components/EventRow';
import { useError } from '../lib/useError';
import { GlassButton, GlassCard } from '../components/Glass';
import { ShiftAlerts } from '../components/ShiftAlerts';
import { Sources } from './Sources';

export function Plan() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [sources, setSources] = useState<CalendarSource[] | null>(null);
  const [alerts, setAlerts] = useState<ShiftChange[]>([]);
  const [error, setError] = useError();

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const byDay = useMemo(() => groupByDay(events, days), [events, days]);
  const today = dayKey(new Date());

  const loadMeta = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([getSources(), getAlerts()]);
      setSources(s);
      setAlerts(a);
    } catch (e) {
      setError(friendly(e));
      setSources((s) => s ?? []);
    }
  }, [setError]);

  const loadEvents = useCallback(async () => {
    try {
      const { from, to } = rangeOf(weekStart, 7);
      setEvents(await getEvents(from, to));
    } catch (e) {
      setError(friendly(e));
    }
  }, [weekStart, setError]);

  useEffect(() => void loadMeta(), [loadMeta]);
  useEffect(() => void loadEvents(), [loadEvents]);

  const refresh = () => {
    void loadMeta();
    void loadEvents();
  };
  const label = `${days[0]!.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6]!.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Plan</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <GlassButton
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            ←
          </GlassButton>
          <GlassButton
            className="whitespace-nowrap"
            onClick={() => setWeekStart(mondayOf(new Date()))}
          >
            This week
          </GlassButton>
          <GlassButton aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            →
          </GlassButton>
          <span className="ml-1 whitespace-nowrap text-sm text-[var(--ink-soft)]">{label}</span>
        </div>
      </header>

      {error && (
        <GlassCard role="alert" className="text-sm">
          {error} Calendars need the server, so they don’t load when only the front end is running.
        </GlassCard>
      )}

      <ShiftAlerts
        alerts={alerts}
        onDismiss={(id) => {
          setAlerts((a) => a.filter((x) => x.id !== id));
          void ackAlert(id).catch(() => void loadMeta());
        }}
      />

      <ul className="flex flex-wrap gap-4 px-1 text-xs text-[var(--ink-soft)]" aria-label="Legend">
        {(['work', 'school', 'family'] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: KIND_COLOR[k] }}
              aria-hidden="true"
            />
            {KIND_LABEL[k]}
          </li>
        ))}
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        {days.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          const isToday = dayKey(d) === today;
          return (
            <GlassCard
              key={dayKey(d)}
              aria-label={d.toDateString()}
              className={isToday ? 'border-[var(--accent)] !p-4' : '!p-4'}
            >
              <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
                {d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                {isToday && <span className="ml-2 text-[var(--accent-text)]">today</span>}
              </h2>
              {list.length ? (
                <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
                  {list.map((e) => (
                    <EventRow key={`${e.id}-${dayKey(d)}`} e={e} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--ink-soft)]">Nothing scheduled</p>
              )}
            </GlassCard>
          );
        })}
      </div>

      {sources && <Sources sources={sources} onChange={refresh} />}
    </div>
  );
}
