import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '@life/shared';
import {
  deleteSleep,
  friendly,
  getSleep,
  logSleep,
  sleepBed,
  sleepWake,
  type SleepSummary,
} from '../lib/api';
import { useError } from '../lib/useError';
import { GlassButton, GlassCard } from '../components/Glass';

const inputCls =
  'min-h-11 w-full min-w-0 rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const toIso = (local: string) => new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function Sleep({ profile }: { profile: Profile }) {
  const [s, setS] = useState<SleepSummary | null>(null);
  const [error, setError] = useError();
  const [bed, setBed] = useState('');
  const [wake, setWake] = useState('');

  const load = useCallback(async () => {
    try {
      setS(await getSleep());
    } catch (e) {
      setError(friendly(e));
    }
  }, [setError]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(friendly(e));
    }
    await load();
  };

  const last = s?.nights[0];
  const maxMin = Math.max(profile.sleepHours * 60, ...(s?.nights.map((n) => n.minutes) ?? [0]));
  const chart = [...(s?.nights ?? [])].reverse().slice(-14);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Sleep</h1>
      </header>
      {error && (
        <GlassCard role="alert" className="text-sm">
          {error}
        </GlassCard>
      )}

      <GlassCard aria-label="Last night">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Last night</h2>
        <p className="mt-2 font-mono text-4xl">{last ? hm(last.minutes) : '—'}</p>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Aim {profile.sleepHours} h ·{' '}
          {s
            ? s.debtHours > 0
              ? `${s.debtHours} h short this week`
              : 'no sleep debt this week'
            : ''}
        </p>
        {s?.recovery.light && (
          <p role="status" className="mt-3 rounded-2xl bg-[var(--glass-fill-strong)] p-3 text-sm">
            {s.recovery.reason}. New workout suggestions will be shorter and lighter.
          </p>
        )}
      </GlassCard>

      <GlassCard aria-label="Tonight">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Tonight</h2>
        {s ? (
          <>
            <p className="mt-2 text-sm">
              Be in bed by <span className="font-mono text-2xl">{clock(s.suggestion.bedtime)}</span>
            </p>
            <p className="text-xs text-[var(--ink-soft)]">
              For a {clock(s.suggestion.wake)} wake-up, based on {s.suggestion.basedOn}.
            </p>
          </>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {s?.open ? (
            <GlassButton variant="solid" onClick={() => act(sleepWake)}>
              I’m awake (in bed since {clock(s.open)})
            </GlassButton>
          ) : (
            <GlassButton variant="solid" onClick={() => act(sleepBed)}>
              I’m going to bed
            </GlassButton>
          )}
        </div>
      </GlassCard>

      {chart.length > 0 && (
        <GlassCard aria-label="Recent nights">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Recent nights</h2>
          <div
            className="mt-3 flex h-24 items-end gap-1.5"
            role="img"
            aria-label={`Sleep over the last ${chart.length} nights`}
          >
            {chart.map((n) => (
              <div
                key={n.date}
                className="flex flex-1 flex-col items-center justify-end gap-1"
                title={`${n.date}: ${hm(n.minutes)}`}
              >
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${(n.minutes / maxMin) * 100}%`,
                    background:
                      n.minutes >= profile.sleepHours * 60 ? 'var(--ok)' : 'var(--accent)',
                  }}
                />
              </div>
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1 text-sm">
            {(s?.nights ?? []).slice(0, 7).map((n) => (
              <li key={n.date} className="flex items-center justify-between">
                <span>
                  {new Date(`${n.date}T12:00:00`).toLocaleDateString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="flex items-center gap-2 font-mono">
                  {hm(n.minutes)}
                  <button
                    type="button"
                    aria-label={`Delete ${n.date}`}
                    className="min-h-8 px-1 text-xs text-[var(--ink-soft)]"
                    onClick={() => act(() => deleteSleep(n.date))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard aria-label="Add a night" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Add a night</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-[var(--ink-soft)]">
            Went to bed
            <input
              className={inputCls}
              type="datetime-local"
              value={bed}
              onChange={(e) => setBed(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-[var(--ink-soft)]">
            Woke up
            <input
              className={inputCls}
              type="datetime-local"
              value={wake}
              onChange={(e) => setWake(e.target.value)}
            />
          </label>
        </div>
        <GlassButton
          disabled={!bed || !wake}
          onClick={() =>
            act(() =>
              logSleep(toIso(bed), toIso(wake)).then(() => {
                setBed('');
                setWake('');
              }),
            )
          }
        >
          Save night
        </GlassButton>
        <p className="text-xs text-[var(--ink-soft)]">
          Automatic import: Apple Health has no web API, so create an iOS Shortcut that posts{' '}
          <code>{'{"bedAt": …, "wakeAt": …}'}</code> (ISO times) to <code>/api/ingest/sleep</code>{' '}
          with a Cloudflare Access service token. Wearable APIs can post to the same address.
        </p>
      </GlassCard>
    </div>
  );
}
