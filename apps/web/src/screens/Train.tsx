import { useCallback, useEffect, useMemo, useState } from 'react';
import { EXERCISE_BY_ID, type Exercise, type Profile } from '@life/shared';
import {
  decideProposal,
  deleteWorkout,
  friendly,
  getBodyweight,
  getExercises,
  getProposals,
  getSuggestion,
  getTemplates,
  getWorkouts,
  planWeek,
  saveBodyweight,
  saveTemplate,
  saveWorkout,
  type PrOut,
  type Proposal,
  type Template,
  type Workout,
} from '../lib/api';
import { fmtWhen } from '../lib/week';
import { fmtWeight, fromDisplay, toDisplay, unitLabel } from '../lib/units';
import { useCountdown } from '../lib/useCountdown';
import { GlassButton, GlassCard } from '../components/Glass';
import { Spark } from '../components/Spark';

interface DraftSet {
  weight: string;
  reps: string;
  done: boolean;
}
interface DraftBlock {
  exerciseId: string;
  sets: DraftSet[];
  hint?: string;
}

const inputCls =
  'min-h-11 w-full rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';
const today = () => new Date().toLocaleDateString('en-CA');

export function Train({ profile }: { profile: Profile }) {
  const u = profile.units;
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<Workout[]>([]);
  const [weights, setWeights] = useState<{ date: string; kg: number }[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<DraftBlock[] | null>(null);
  const [startedAt, setStartedAt] = useState<string>('');
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [prs, setPrs] = useState<PrOut[]>([]);
  const [busy, setBusy] = useState(false);
  const [bw, setBw] = useState('');
  const rest = useCountdown();

  const load = useCallback(async () => {
    try {
      const [t, h, w, p] = await Promise.all([
        getTemplates(),
        getWorkouts(),
        getBodyweight(),
        getProposals(),
      ]);
      setTemplates(t);
      setHistory(h);
      setWeights(w);
      setProposals(p.filter((x) => x.source === 'scheduler'));
      setError(null);
    } catch (e) {
      setError(friendly(e));
    }
  }, []);
  useEffect(() => {
    getExercises().then(setExercises, () => undefined);
    void load();
  }, [load]);

  const addExercise = async (id: string) => {
    let hint: string | undefined;
    let first: DraftSet = { weight: '', reps: '', done: false };
    try {
      const s = await getSuggestion(id);
      if (s.suggestion) {
        hint = `${s.suggestion.reason}: ${fmtWeight(s.suggestion.weightKg, u)} × ${s.suggestion.reps}`;
        first = {
          weight: String(toDisplay(s.suggestion.weightKg, u)),
          reps: String(s.suggestion.reps),
          done: false,
        };
      }
    } catch {
      /* suggestions are optional */
    }
    setBlocks((b) => [...(b ?? []), { exerciseId: id, hint, sets: [first] }]);
    setSearch('');
  };

  const start = async (t?: Template) => {
    setBlocks([]);
    setStartedAt(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    setTemplateId(t?.id);
    setPrs([]);
    for (const item of t?.items ?? []) {
      await addExercise(item.exerciseId);
      setBlocks((b) =>
        (b ?? []).map((x) =>
          x.exerciseId === item.exerciseId && x.sets.length === 1
            ? {
                ...x,
                sets: Array.from({ length: item.sets }, (_, i) => ({
                  ...x.sets[0]!,
                  reps: x.sets[0]!.reps || String(item.reps),
                  done: false,
                  weight: i >= 0 ? x.sets[0]!.weight : '',
                })),
              }
            : x,
        ),
      );
    }
  };

  const patchSet = (bi: number, si: number, patch: Partial<DraftSet>) =>
    setBlocks((b) =>
      b!.map((x, i) =>
        i === bi ? { ...x, sets: x.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : x,
      ),
    );

  const finish = async () => {
    const sets = (blocks ?? []).flatMap((b) =>
      b.sets
        .filter((s) => s.done && Number(s.reps) > 0)
        .map((s) => ({
          exerciseId: b.exerciseId,
          reps: Math.round(Number(s.reps)),
          weightKg: fromDisplay(Number(s.weight) || 0, u),
        })),
    );
    if (!sets.length) return setError('Tick at least one set as done first.');
    setBusy(true);
    try {
      const r = await saveWorkout({
        name: 'Workout',
        startedAt,
        endedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        templateId,
        sets,
      });
      setPrs(r.prs);
      setBlocks(null);
      rest.stop();
      await load();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? exercises
          .filter((e) => e.name.toLowerCase().includes(q) || e.muscle.includes(q))
          .slice(0, 6)
      : [];
  }, [search, exercises]);

  const plan = async () => {
    try {
      const r = await planWeek();
      setError(r.sessions.length ? null : 'No room for sessions this week with your limits.');
      await load();
    } catch (e) {
      setError(friendly(e));
    }
  };
  const decide = async (id: string, a: 'approve' | 'reject') => {
    await decideProposal(id, a).catch((e) => setError(friendly(e)));
    await load();
  };

  const saveAsTemplate = async () => {
    const name = window.prompt('Name this template');
    if (!name || !blocks?.length) return;
    await saveTemplate({
      name,
      items: blocks.map((b) => ({
        exerciseId: b.exerciseId,
        sets: b.sets.length,
        reps: Math.round(Number(b.sets[0]?.reps)) || 8,
      })),
    }).catch((e) => setError(friendly(e)));
    await load();
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Train</h1>
      </header>

      {error && (
        <GlassCard role="alert" className="text-sm">
          {error}
        </GlassCard>
      )}

      {prs.length > 0 && (
        <GlassCard aria-label="New personal records" className="border-[var(--accent)]">
          <h2 className="font-display text-2xl">
            New personal record{prs.length > 1 ? 's' : ''} 🎉
          </h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {prs.map((p, i) => (
              <li key={i}>
                {p.name}: {fmtWeight(p.weightKg, u)} × {p.reps}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard aria-label="This week's plan">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
            Suggested sessions
          </h2>
          <GlassButton onClick={plan} className="!min-h-10">
            Plan my week
          </GlassButton>
        </div>
        {proposals.length ? (
          <ul className="mt-3 grid gap-3">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0 basis-48 flex-1">
                  <p className="font-medium">{p.payload.title}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {fmtWhen(p.payload.start, p.payload.end)}
                  </p>
                  <p className="text-xs text-[var(--ink-soft)]">{p.summary}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => decide(p.id, 'approve')}
                    className="min-h-11 rounded-full bg-[var(--accent)] px-4 text-white"
                  >
                    Add to calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(p.id, 'reject')}
                    className="min-h-11 px-3 text-[var(--ink-soft)]"
                  >
                    Skip
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Nothing proposed. Plan fits sessions around your shifts, meals and bedtime, and only
            adds them to your calendar when you approve.
          </p>
        )}
      </GlassCard>

      {blocks === null ? (
        <GlassCard aria-label="Start a workout">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Workout</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <GlassButton variant="solid" onClick={() => start()}>
              Start empty workout
            </GlassButton>
            {templates.map((t) => (
              <GlassButton key={t.id} onClick={() => start(t)}>
                {t.name}
              </GlassButton>
            ))}
          </div>
        </GlassCard>
      ) : (
        <GlassCard aria-label="Workout in progress" className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Workout</h2>
            {rest.left > 0 && (
              <div
                role="timer"
                aria-live="off"
                className="flex items-center gap-2 rounded-full bg-[var(--glass-fill-strong)] px-3 py-1 text-sm"
              >
                Rest {Math.floor(rest.left / 60)}:{String(rest.left % 60).padStart(2, '0')}
                <button
                  type="button"
                  aria-label="Add 15 seconds"
                  onClick={() => rest.add(15)}
                  className="min-h-8 px-1"
                >
                  +15
                </button>
                <button
                  type="button"
                  aria-label="Skip rest"
                  onClick={rest.stop}
                  className="min-h-8 px-1"
                >
                  Skip
                </button>
              </div>
            )}
          </div>
          {blocks.map((b, bi) => (
            <fieldset key={bi} className="grid gap-2">
              <legend className="font-medium">{EXERCISE_BY_ID.get(b.exerciseId)?.name}</legend>
              {b.hint && <p className="text-xs text-[var(--ink-soft)]">{b.hint}</p>}
              {b.sets.map((s, si) => (
                <div key={si} className="grid grid-cols-[2rem_1fr_1fr_2.75rem] items-center gap-2">
                  <span className="text-sm text-[var(--ink-soft)]">{si + 1}</span>
                  <input
                    aria-label={`Set ${si + 1} weight (${unitLabel(u)})`}
                    className={inputCls}
                    inputMode="decimal"
                    placeholder={unitLabel(u)}
                    value={s.weight}
                    onChange={(e) => patchSet(bi, si, { weight: e.target.value })}
                  />
                  <input
                    aria-label={`Set ${si + 1} reps`}
                    className={inputCls}
                    inputMode="numeric"
                    placeholder="reps"
                    value={s.reps}
                    onChange={(e) => patchSet(bi, si, { reps: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-pressed={s.done}
                    aria-label={`Set ${si + 1} done`}
                    onClick={() => {
                      patchSet(bi, si, { done: !s.done });
                      if (!s.done) rest.start(90);
                    }}
                    className={`min-h-11 rounded-xl text-lg ${s.done ? 'bg-[var(--ok)] text-white' : 'border border-black/10 dark:border-white/20'}`}
                  >
                    ✓
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setBlocks((x) =>
                    x!.map((y, i) =>
                      i === bi
                        ? { ...y, sets: [...y.sets, { ...y.sets.at(-1)!, done: false }] }
                        : y,
                    ),
                  )
                }
                className="min-h-11 justify-self-start text-sm text-[var(--accent)]"
              >
                + Add set
              </button>
            </fieldset>
          ))}
          <div className="relative">
            <input
              aria-label="Add exercise"
              className={inputCls}
              placeholder="Add exercise (try “squat” or “chest”)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {matches.length > 0 && (
              <ul className="glass absolute z-10 mt-1 w-full overflow-hidden rounded-2xl">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => addExercise(m.id)}
                      className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm"
                    >
                      {m.name}
                      <span className="text-xs text-[var(--ink-soft)]">{m.muscle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <GlassButton
              onClick={() => {
                setBlocks(null);
                rest.stop();
              }}
            >
              Discard
            </GlassButton>
            <div className="flex gap-2">
              <GlassButton onClick={saveAsTemplate} disabled={!blocks.length}>
                Save as template
              </GlassButton>
              <GlassButton variant="solid" onClick={finish} disabled={busy}>
                Finish
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      )}

      <GlassCard aria-label="Bodyweight">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Bodyweight</h2>
          <Spark
            values={[...weights].reverse().map((w) => toDisplay(w.kg, u))}
            label="Bodyweight trend"
          />
        </div>
        <p className="mt-2 font-mono text-2xl">{weights[0] ? fmtWeight(weights[0].kg, u) : '—'}</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Number(bw);
            if (!(v > 0)) return;
            await saveBodyweight(today(), fromDisplay(v, u)).catch((er) => setError(friendly(er)));
            setBw('');
            await load();
          }}
        >
          <input
            aria-label={`Today's weight (${unitLabel(u)})`}
            className={inputCls}
            inputMode="decimal"
            placeholder={`Today (${unitLabel(u)})`}
            value={bw}
            onChange={(e) => setBw(e.target.value)}
          />
          <GlassButton type="submit">Save</GlassButton>
        </form>
      </GlassCard>

      <GlassCard aria-label="History">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">History</h2>
        {history.length ? (
          <ul className="mt-3 grid gap-3">
            {history.map((w) => (
              <li key={w.id} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">
                    {new Date(w.startedAt).toLocaleDateString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · {w.sets.length} sets
                  </p>
                  <button
                    type="button"
                    aria-label="Delete workout"
                    onClick={() => deleteWorkout(w.id).then(load)}
                    className="min-h-8 px-2 text-xs text-[var(--ink-soft)]"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-xs text-[var(--ink-soft)]">
                  {[...new Set(w.sets.map((s) => EXERCISE_BY_ID.get(s.exerciseId)?.name))].join(
                    ', ',
                  )}
                  {w.sets.some((s) => s.pr) ? ' · PR' : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            No workouts yet. Log one in under a minute.
          </p>
        )}
      </GlassCard>
    </div>
  );
}
