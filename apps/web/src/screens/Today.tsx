import { useCallback, useEffect, useState } from 'react';
import type { CalEvent, Profile, ShiftChange } from '@life/shared';
import { EventRow } from '../components/EventRow';
import { GlassCard } from '../components/Glass';
import { ProgressRing } from '../components/ProgressRing';
import { ShiftAlerts } from '../components/ShiftAlerts';
import {
  ackAlert,
  decideProposal,
  getAlerts,
  getDayLog,
  getEmailSummary,
  getEvents,
  getProposals,
  getSleep,
  getWorkouts,
  type DayLog,
  type Proposal,
  type SleepSummary,
} from '../lib/api';
import { fmtWhen, mondayOf, rangeOf } from '../lib/week';

const greeting = (h: number) =>
  h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function Today({ profile, onEditSetup }: { profile: Profile; onEditSetup: () => void }) {
  const now = new Date();
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [alerts, setAlerts] = useState<ShiftChange[]>([]);
  const [log, setLog] = useState<DayLog | null>(null);
  const [workoutsThisWeek, setWorkoutsThisWeek] = useState<number | null>(null);
  const [sleep, setSleep] = useState<SleepSummary | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [mail, setMail] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { from, to } = rangeOf(start, 1);
    getEvents(from, to).then(setEvents, () => setEvents([]));
    getAlerts().then(setAlerts, () => setAlerts([]));
    getDayLog(start.toLocaleDateString('en-CA')).then(setLog, () => setLog(null));
    getWorkouts().then(
      (w) => setWorkoutsThisWeek(w.filter((x) => new Date(x.startedAt) >= mondayOf(start)).length),
      () => setWorkoutsThisWeek(null),
    );
    getSleep().then(setSleep, () => setSleep(null));
    getProposals().then(setProposals, () => setProposals([]));
    getEmailSummary().then(
      (s) => setMail(s.counts),
      () => setMail({}),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => load(), [load]);

  const kcal = log?.totals.kcal ?? 0;
  const kTarget = log?.targets.kcal ?? profile.calorieTarget;
  const goal = profile.workoutsPerWeek;
  const last = sleep?.nights[0];
  const mailTotal = Object.values(mail).reduce((a, b) => a + b, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--ink-soft)]">
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <button
            type="button"
            onClick={onEditSetup}
            className="min-h-11 px-2 text-sm text-[var(--ink-soft)] underline-offset-4 hover:underline"
          >
            Edit setup
          </button>
        </div>
        <h1 className="font-display text-5xl italic leading-tight">
          {greeting(now.getHours())}
          {profile.name ? `, ${profile.name}` : ''}.
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-4">
        {alerts.length > 0 && (
          <div className="col-span-2">
            <ShiftAlerts
              alerts={alerts}
              onDismiss={(id) => {
                setAlerts((a) => a.filter((x) => x.id !== id));
                void ackAlert(id).catch(() => undefined);
              }}
            />
          </div>
        )}

        {proposals.length > 0 && (
          <GlassCard aria-label="Waiting for you" className="col-span-2 border-[var(--accent)]">
            <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
              Waiting for your tap
            </h2>
            <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
              {proposals.slice(0, 4).map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="font-medium">{p.payload.title}</p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {fmtWhen(p.payload.start, p.payload.end)} · from {p.source}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="min-h-11 rounded-full bg-[var(--accent)] px-4 text-white"
                      onClick={() => decideProposal(p.id, 'approve').then(load, () => undefined)}
                    >
                      Add to calendar
                    </button>
                    <button
                      type="button"
                      className="min-h-11 px-3 text-[var(--ink-soft)]"
                      onClick={() => decideProposal(p.id, 'reject').then(load, () => undefined)}
                    >
                      Skip
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {proposals.length > 4 && (
              <p className="mt-2 text-xs text-[var(--ink-soft)]">and {proposals.length - 4} more</p>
            )}
          </GlassCard>
        )}

        <GlassCard className="col-span-2 sm:col-span-1" aria-label="Schedule">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Schedule</h2>
          {events === null ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">Loading…</p>
          ) : events.length ? (
            <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
              {events.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          ) : (
            <>
              <p className="mt-3 font-display text-2xl">Nothing today</p>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Add calendars from the Plan page.
              </p>
            </>
          )}
        </GlassCard>

        <GlassCard className="col-span-2 grid gap-3 sm:col-span-1" aria-label="Tonight">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Sleep</h2>
          <p className="font-mono text-3xl">{last ? hm(last.minutes) : 'No data yet'}</p>
          <p className="text-sm text-[var(--ink-soft)]">
            {sleep
              ? sleep.debtHours > 0
                ? `${sleep.debtHours} h short this week. `
                : 'No sleep debt. '
              : ''}
            {sleep ? `Bed by ${clock(sleep.suggestion.bedtime)} tonight.` : ''}
          </p>
          {sleep?.recovery.light && (
            <p className="text-sm">{sleep.recovery.reason}, so workouts are light.</p>
          )}
        </GlassCard>

        <GlassCard className="grid place-items-center gap-1" aria-label="Calories">
          <ProgressRing
            value={kTarget ? kcal / kTarget : 0}
            label="Calories"
            caption={
              kTarget
                ? `${Math.round(kcal)} of ${kTarget} kcal`
                : `${Math.round(kcal)} kcal, no target set`
            }
          />
          <p className="text-xs text-[var(--ink-soft)]">
            {kTarget ? `${Math.round(kcal)} of ${kTarget} kcal` : `${Math.round(kcal)} kcal today`}
          </p>
        </GlassCard>

        <GlassCard className="grid place-items-center gap-1" aria-label="Workouts">
          <ProgressRing
            value={workoutsThisWeek !== null && goal ? workoutsThisWeek / goal : 0}
            label="Workouts"
            caption={`${workoutsThisWeek ?? 0} of ${goal} this week`}
          />
          <p className="text-xs text-[var(--ink-soft)]">
            {workoutsThisWeek ?? 0} of {goal} this week
          </p>
        </GlassCard>

        {mailTotal > 0 && (
          <GlassCard className="col-span-2" aria-label="Email this week">
            <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
              Email this week
            </h2>
            <p className="mt-2 text-sm">
              {Object.entries(mail)
                .map(([k, n]) => `${n} ${k}`)
                .join(' · ')}
            </p>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
