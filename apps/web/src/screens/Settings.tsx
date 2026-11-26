import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '@life/shared';
import { friendly, getLunchRules, putLunchRules } from '../lib/api';
import {
  createFamilyLink,
  deleteNotify,
  download,
  getAudit,
  getFamilyLinks,
  getNotify,
  killSwitch,
  putNotify,
  restoreBackup,
  revokeFamilyLinks,
  testNotify,
  type AuditRow,
} from '../lib/adminApi';
import { GlassButton, GlassCard } from '../components/Glass';

const inputCls =
  'min-h-11 w-full rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  optional,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  optional?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span>
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <input
        className={inputCls}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        placeholder={optional ? 'Not set' : undefined}
        onChange={(e) =>
          onChange(e.target.value === '' ? (optional ? null : min) : Number(e.target.value))
        }
      />
    </label>
  );
}

export function Settings({
  profile,
  onSave,
  onRedoSetup,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
  onRedoSetup: () => void;
}) {
  const [p, setP] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lunch, setLunch] = useState<
    Record<number, { name: string; kcal: string; protein: string }>
  >({});
  const [notify, setNotify] = useState<{ configured: boolean; bedtimeReminder: boolean } | null>(
    null,
  );
  const [topic, setTopic] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [killText, setKillText] = useState('');

  const load = useCallback(async () => {
    try {
      const [rules, n, l, a] = await Promise.all([
        getLunchRules(),
        getNotify(),
        getFamilyLinks(),
        getAudit(),
      ]);
      setLunch(
        Object.fromEntries(
          rules.map((r) => [
            r.weekday,
            { name: r.name, kcal: String(r.kcal), protein: String(r.protein) },
          ]),
        ),
      );
      setNotify(n);
      setLinks(l);
      setAudit(a.slice(0, 12));
    } catch (e) {
      setError(friendly(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const guard = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
    } catch (e) {
      setError(friendly(e));
    }
    await load();
  };
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setP({ ...p, [k]: v });
    setSaved(false);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">You</h1>
      </header>
      {error && (
        <GlassCard role="alert" className="text-sm">
          {error}
        </GlassCard>
      )}
      {note && (
        <p role="status" className="px-1 text-sm text-[var(--ok)]">
          {note}
        </p>
      )}

      <GlassCard aria-label="Goals and planning" className="grid gap-4">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
          Goals and planning
        </h2>
        <fieldset className="flex gap-2">
          <legend className="mb-1 text-sm">Units</legend>
          {(['lb', 'kg'] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={p.units === u}
              onClick={() => set('units', u)}
              className={`min-h-11 rounded-full px-5 text-sm ${p.units === u ? 'bg-[var(--accent)] text-white' : 'glass'}`}
            >
              {u === 'lb' ? 'Pounds' : 'Kilograms'}
            </button>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Num
            label="Calorie target"
            unit="kcal"
            value={p.calorieTarget}
            min={800}
            max={6000}
            step={50}
            optional
            onChange={(v) => set('calorieTarget', v)}
          />
          <Num
            label="Protein target"
            unit="g"
            value={p.proteinTarget}
            min={20}
            max={400}
            optional
            onChange={(v) => set('proteinTarget', v)}
          />
          <Num
            label="Workouts a week"
            value={p.workoutsPerWeek}
            min={0}
            max={14}
            onChange={(v) => set('workoutsPerWeek', v ?? 3)}
          />
          <Num
            label="Session length"
            unit="min"
            value={p.sessionMinutes}
            min={20}
            max={180}
            step={5}
            onChange={(v) => set('sessionMinutes', v ?? 60)}
          />
          <Num
            label="Sleep goal"
            unit="h"
            value={p.sleepHours}
            min={4}
            max={12}
            step={0.5}
            onChange={(v) => set('sleepHours', v ?? 8)}
          />
          <label className="grid gap-1 text-sm">
            <span>Usual wake time</span>
            <input
              className={inputCls}
              type="time"
              value={p.wakeTime}
              onChange={(e) => set('wakeTime', e.target.value)}
            />
          </label>
          <Num
            label="No training within"
            unit="h of bedtime"
            value={p.noTrainWithinBedtimeHours}
            min={0}
            max={6}
            step={0.5}
            onChange={(v) => set('noTrainWithinBedtimeHours', v ?? 2)}
          />
          <Num
            label="No training on shifts over"
            unit="h"
            value={p.noTrainOnShiftOverHours}
            min={4}
            max={24}
            step={0.5}
            onChange={(v) => set('noTrainOnShiftOverHours', v ?? 10)}
          />
        </div>
        <label className="grid gap-1 text-sm">
          <span>Best time to train</span>
          <select
            className={inputCls}
            value={p.trainTime}
            onChange={(e) => set('trainTime', e.target.value as Profile['trainTime'])}
          >
            <option value="auto">Learn from my workouts</option>
            <option value="morning">Morning</option>
            <option value="midday">Midday</option>
            <option value="evening">Evening</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GlassButton onClick={onRedoSetup}>Redo setup</GlassButton>
          <GlassButton
            variant="solid"
            onClick={() => {
              onSave(p);
              setSaved(true);
            }}
          >
            {saved ? 'Saved ✓' : 'Save'}
          </GlassButton>
        </div>
      </GlassCard>

      <GlassCard aria-label="School lunch" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
          School lunch by weekday
        </h2>
        <p className="text-sm text-[var(--ink-soft)]">
          Used by the one-tap lunch card on Fuel (turn it on under Redo setup). Leave a day empty
          for no lunch.
        </p>
        {DAYS.map((d, i) => {
          const r = lunch[i + 1] ?? { name: '', kcal: '', protein: '' };
          const upd = (patch: Partial<typeof r>) =>
            setLunch({ ...lunch, [i + 1]: { ...r, ...patch } });
          return (
            <div key={d} className="grid grid-cols-[4.5rem_1fr_4.5rem_4.5rem] items-center gap-2">
              <span className="text-sm">{d.slice(0, 3)}</span>
              <input
                aria-label={`${d} lunch`}
                className={inputCls}
                placeholder="e.g. Pizza"
                value={r.name}
                onChange={(e) => upd({ name: e.target.value })}
              />
              <input
                aria-label={`${d} calories`}
                className={inputCls}
                inputMode="numeric"
                placeholder="kcal"
                value={r.kcal}
                onChange={(e) => upd({ kcal: e.target.value })}
              />
              <input
                aria-label={`${d} protein`}
                className={inputCls}
                inputMode="numeric"
                placeholder="P g"
                value={r.protein}
                onChange={(e) => upd({ protein: e.target.value })}
              />
            </div>
          );
        })}
        <GlassButton
          className="justify-self-end"
          onClick={() =>
            guard(
              () =>
                putLunchRules(
                  Object.entries(lunch)
                    .filter(([, r]) => r.name.trim() && Number(r.kcal) >= 0 && r.kcal !== '')
                    .map(([wd, r]) => ({
                      weekday: Number(wd),
                      name: r.name.trim(),
                      kcal: Number(r.kcal),
                      protein: Number(r.protein) || 0,
                      carbs: 0,
                      fat: 0,
                    })),
                ),
              'Lunch rules saved',
            )
          }
        >
          Save lunch rules
        </GlassButton>
      </GlassCard>

      <GlassCard aria-label="Notifications" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
          Phone notifications
        </h2>
        <p className="text-sm text-[var(--ink-soft)]">
          Free through ntfy: install the ntfy app, subscribe to a long random topic name, and enter
          the same name here. The server sends the notices, so your phone never exposes anything.
          Treat the topic like a password.
        </p>
        {notify?.configured ? (
          <div className="grid gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notify.bedtimeReminder}
                onChange={(e) => guard(() => putNotify({ bedtimeReminder: e.target.checked }))}
              />
              Remind me 30 minutes before bedtime
            </label>
            <div className="flex gap-2">
              <GlassButton onClick={() => guard(testNotify, 'Test sent')}>Send a test</GlassButton>
              <GlassButton onClick={() => guard(deleteNotify, 'Notifications turned off')}>
                Turn off
              </GlassButton>
            </div>
            <p className="text-xs text-[var(--ink-soft)]">
              Also sent whenever a work shift changes.
            </p>
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void guard(() => putNotify({ topic }).then(() => setTopic('')), 'Saved');
            }}
          >
            <input
              aria-label="ntfy topic"
              className={inputCls}
              placeholder="e.g. life-k3f9x2m7q1z8"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <GlassButton type="submit" disabled={topic.length < 8}>
              Save
            </GlassButton>
          </form>
        )}
      </GlassCard>

      <GlassCard aria-label="Family link" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Family link</h2>
        <p className="text-sm text-[var(--ink-soft)]">
          A read-only page of this week’s school, family and Dashboard events, with no work shifts,
          places or health data. It stops working on its own after the days you choose, and you can
          revoke it any time.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Valid for
            <select
              aria-label="Link lifetime"
              className="rounded-lg border border-black/10 bg-white/50 px-2 py-2 dark:border-white/20 dark:bg-white/10"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} day{d > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
          <GlassButton
            onClick={() =>
              guard(async () => {
                const r = await createFamilyLink(days);
                setNewLink(`${window.location.origin}/family?t=${r.token}`);
              })
            }
          >
            Create link
          </GlassButton>
        </div>
        {newLink && (
          <div className="grid gap-1 rounded-2xl bg-[var(--glass-fill-strong)] p-3 text-sm">
            <p className="font-medium">Copy it now. It will not be shown again.</p>
            <input
              aria-label="Family link"
              readOnly
              className={inputCls}
              value={newLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <GlassButton
              className="justify-self-start"
              onClick={() => void navigator.clipboard?.writeText(newLink)}
            >
              Copy
            </GlassButton>
          </div>
        )}
        {links.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {links.length} active link{links.length > 1 ? 's' : ''}, next ends{' '}
              {new Date(links[0]!).toLocaleDateString()}
            </span>
            <GlassButton
              onClick={() =>
                guard(async () => {
                  await revokeFamilyLinks();
                  setNewLink(null);
                }, 'All family links revoked')
              }
            >
              Revoke all
            </GlassButton>
          </div>
        )}
      </GlassCard>

      <GlassCard aria-label="Your data" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Your data</h2>
        <div className="flex flex-wrap gap-2">
          <GlassButton
            onClick={() => guard(() => download('GET', '/api/admin/export', 'life-export.json'))}
          >
            Export JSON
          </GlassButton>
          {['food_log', 'workouts', 'sets', 'sleep_log', 'bodyweight'].map((t) => (
            <GlassButton
              key={t}
              className="!min-h-10"
              onClick={() =>
                guard(() => download('GET', `/api/admin/export?format=csv&table=${t}`, `${t}.csv`))
              }
            >
              {t.replace('_', ' ')} CSV
            </GlassButton>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <GlassButton
            onClick={() =>
              guard(
                () => download('POST', '/api/admin/backup', 'life-backup.enc'),
                'Encrypted backup downloaded',
              )
            }
          >
            Download encrypted backup
          </GlassButton>
          <label className="glass inline-flex min-h-11 cursor-pointer items-center rounded-full px-5 text-sm font-medium">
            Restore from backup
            <input
              type="file"
              accept=".enc,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (
                  !f ||
                  !window.confirm('Restoring replaces ALL current data with the backup. Continue?')
                )
                  return;
                await guard(async () => {
                  await restoreBackup(await f.text());
                  window.location.reload();
                }, 'Restored');
              }}
            />
          </label>
        </div>
        <p className="text-xs text-[var(--ink-soft)]">
          Backups are encrypted with your server key (and kept nightly in R2 if you set that up).
          Exports leave out passwords, tokens and calendar links.
        </p>
      </GlassCard>

      <GlassCard aria-label="Safety" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Safety</h2>
        <details>
          <summary className="min-h-11 cursor-pointer text-sm">
            Recent changes the app made ({audit.length})
          </summary>
          <ul className="mt-2 grid gap-1 text-xs text-[var(--ink-soft)]">
            {audit.map((a) => (
              <li key={a.id}>
                {a.at} · {a.source} · {a.action} · {a.target ?? ''} · {a.result}
              </li>
            ))}
          </ul>
        </details>
        <div className="grid gap-2 rounded-2xl border border-red-400/60 p-3">
          <p className="text-sm font-medium">Kill switch</p>
          <p className="text-xs text-[var(--ink-soft)]">
            Instantly disconnects Home Assistant, calendar links, notifications and family links.
            Your own data stays. Type REVOKE to enable the button.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Type REVOKE to confirm"
              className={inputCls}
              placeholder="REVOKE"
              value={killText}
              onChange={(e) => setKillText(e.target.value)}
            />
            <GlassButton
              disabled={killText !== 'REVOKE'}
              onClick={() =>
                guard(async () => {
                  const r = await killSwitch();
                  setKillText('');
                  setNewLink(null);
                  setNote(
                    `Revoked everything (${r.revoked.calendars} calendar link${r.revoked.calendars === 1 ? '' : 's'})`,
                  );
                })
              }
            >
              Revoke all
            </GlassButton>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
