import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '@life/shared';
import {
  addLog,
  barcodeLookup,
  confirmLunch,
  deleteLog,
  friendly,
  getDayLog,
  getLunch,
  getMeals,
  logMeal,
  saveFood,
  saveMeal,
  searchFood,
  type DayLog,
  type FoodHit,
  type LunchToday,
  type Slot,
} from '../lib/api';
import { BarcodeScanner, canScan } from '../components/BarcodeScanner';
import { GlassButton, GlassCard } from '../components/Glass';
import { ProgressRing } from '../components/ProgressRing';

const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const inputCls =
  'min-h-11 w-full rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';
const todayKey = () => new Date().toLocaleDateString('en-CA');
const defaultSlot = (): Slot => {
  const h = new Date().getHours();
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
};

export function Fuel({ profile }: { profile: Profile }) {
  const date = todayKey();
  const [log, setLog] = useState<DayLog | null>(null);
  const [lunch, setLunch] = useState<LunchToday | null>(null);
  const [meals, setMeals] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FoodHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [slot, setSlot] = useState<Slot>(defaultSlot());
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState('');
  const [quick, setQuick] = useState({ name: '', kcal: '', protein: '' });

  const load = useCallback(async () => {
    try {
      const [l, u, m] = await Promise.all([getDayLog(date), getLunch(date), getMeals()]);
      setLog(l);
      setLunch(u);
      setMeals(m);
      setError(null);
    } catch (e) {
      setError(friendly(e));
    }
  }, [date]);
  useEffect(() => void load(), [load]);

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await searchFood(q);
      setHits([...r.saved.map((s) => ({ ...s, source: 'saved' })), ...r.results]);
      setError(
        r.sources.openfoodfacts === 'error' && r.sources.usda === 'error'
          ? 'Food databases are unreachable right now. Add it manually below.'
          : null,
      );
    } catch (er) {
      setError(friendly(er));
    } finally {
      setSearching(false);
    }
  };

  const add = async (h: FoodHit, source = 'search') => {
    await addLog({
      date,
      slot,
      name: h.brand ? `${h.name} (${h.brand})` : h.name,
      kcal: h.kcal,
      protein: h.protein,
      carbs: h.carbs,
      fat: h.fat,
      source,
    }).catch((e) => setError(friendly(e)));
    setHits([]);
    setQ('');
    await load();
  };

  const lookup = useCallback(
    async (c: string) => {
      setScan(false);
      try {
        const { food } = await barcodeLookup(c.trim());
        await add(food, 'barcode');
        setCode('');
      } catch {
        setError('That barcode was not found. Add it manually below.');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slot, date],
  );

  const kcal = log?.totals.kcal ?? 0;
  const target = log?.targets.kcal ?? profile.calorieTarget;
  const pTarget = log?.targets.protein ?? profile.proteinTarget;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Fuel</h1>
      </header>
      {error && (
        <GlassCard role="alert" className="text-sm">
          {error}
        </GlassCard>
      )}

      <GlassCard
        className="grid grid-cols-[auto_1fr] items-center gap-5"
        aria-label="Today's calories"
      >
        <ProgressRing
          value={target ? kcal / target : 0}
          label="Calories"
          caption={target ? `${kcal} of ${target}` : `${kcal} so far`}
        />
        <div className="grid gap-2 text-sm">
          <p>
            <span className="font-mono text-2xl">{Math.round(kcal)}</span> kcal
            {target ? ` of ${target}` : ''}
          </p>
          <p className="text-[var(--ink-soft)]">
            Protein {Math.round(log?.totals.protein ?? 0)} g{pTarget ? ` of ${pTarget} g` : ''}
            {pTarget && (log?.totals.protein ?? 0) < pTarget
              ? ` · ${Math.round(pTarget - (log?.totals.protein ?? 0))} g to go`
              : ''}
          </p>
          <p className="text-[var(--ink-soft)]">
            Carbs {Math.round(log?.totals.carbs ?? 0)} g · Fat {Math.round(log?.totals.fat ?? 0)} g
          </p>
          {!target && (
            <p className="text-xs text-[var(--ink-soft)]">Set a calorie target under You.</p>
          )}
        </div>
      </GlassCard>

      {lunch?.enabled && lunch.rule && (
        <GlassCard aria-label="School lunch">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">School lunch</h2>
          <p className="mt-2 font-medium">
            {lunch.rule.name}{' '}
            <span className="font-normal text-[var(--ink-soft)]">· {lunch.rule.kcal} kcal</span>
          </p>
          {lunch.status ? (
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Marked:{' '}
              {lunch.status === 'ate'
                ? 'ate it'
                : lunch.status === 'skipped'
                  ? 'skipped'
                  : 'something else'}
              .{' '}
              <button
                type="button"
                className="min-h-11 text-[var(--accent)]"
                onClick={() => confirmLunch({ date, action: 'skipped' }).then(load)}
              >
                Change
              </button>
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <GlassButton
                variant="solid"
                onClick={() =>
                  confirmLunch({ date, action: 'ate' }).then(load, (e) => setError(friendly(e)))
                }
              >
                Ate it
              </GlassButton>
              <GlassButton onClick={() => confirmLunch({ date, action: 'skipped' }).then(load)}>
                Skipped
              </GlassButton>
              <GlassButton
                onClick={() => {
                  setSlot('lunch');
                  document.getElementById('food-search')?.focus();
                }}
              >
                Something else
              </GlassButton>
            </div>
          )}
        </GlassCard>
      )}

      <GlassCard aria-label="Add food" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Add food</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Meal">
          {SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={slot === s}
              onClick={() => setSlot(s)}
              className={`min-h-11 rounded-full px-4 text-sm capitalize ${slot === s ? 'bg-[var(--accent)] text-white' : 'glass'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={find} className="flex gap-2">
          <input
            id="food-search"
            aria-label="Search foods"
            className={inputCls}
            placeholder="Search foods (e.g. greek yogurt)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <GlassButton type="submit" disabled={searching}>
            {searching ? '…' : 'Search'}
          </GlassButton>
        </form>
        {hits.length > 0 && (
          <ul className="grid gap-1" aria-label="Search results">
            {hits.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => add(h, h.source === 'saved' ? 'manual' : 'search')}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 text-left text-sm hover:bg-[var(--glass-fill-strong)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{h.name}</span>
                    <span className="block truncate text-xs text-[var(--ink-soft)]">
                      {h.brand ? `${h.brand} · ` : ''}
                      {h.serving}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs">
                    {h.kcal} kcal · {h.protein} P
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void lookup(code);
          }}
        >
          <input
            aria-label="Barcode number"
            className={inputCls}
            inputMode="numeric"
            placeholder="Barcode number"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <GlassButton type="submit">Look up</GlassButton>
          {canScan() && <GlassButton onClick={() => setScan(true)}>Scan</GlassButton>}
        </form>
        {scan && <BarcodeScanner onCode={lookup} onClose={() => setScan(false)} />}
        <form
          className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const k = Number(quick.kcal);
            if (!quick.name.trim() || !(k >= 0)) return;
            await addLog({
              date,
              slot,
              name: quick.name.trim(),
              kcal: k,
              protein: Number(quick.protein) || 0,
              carbs: 0,
              fat: 0,
            }).catch((er) => setError(friendly(er)));
            setQuick({ name: '', kcal: '', protein: '' });
            await load();
          }}
        >
          <input
            aria-label="Quick add name"
            className={inputCls}
            placeholder="Quick add"
            value={quick.name}
            onChange={(e) => setQuick({ ...quick, name: e.target.value })}
          />
          <input
            aria-label="Quick add calories"
            className={inputCls}
            inputMode="numeric"
            placeholder="kcal"
            value={quick.kcal}
            onChange={(e) => setQuick({ ...quick, kcal: e.target.value })}
          />
          <input
            aria-label="Quick add protein"
            className={inputCls}
            inputMode="numeric"
            placeholder="P g"
            value={quick.protein}
            onChange={(e) => setQuick({ ...quick, protein: e.target.value })}
          />
          <GlassButton type="submit">Add</GlassButton>
        </form>
        {meals.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--ink-soft)]">Saved meals:</span>
            {meals.map((m) => (
              <GlassButton
                key={m.id}
                className="!min-h-10"
                onClick={() => logMeal(m.id, date, slot).then(load, (e) => setError(friendly(e)))}
              >
                {m.name}
              </GlassButton>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard aria-label="Food log">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Today</h2>
        {SLOTS.map((s) => {
          const items = (log?.entries ?? []).filter((e) => e.slot === s);
          if (!items.length) return null;
          return (
            <section key={s} className="mt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium capitalize">{s}</h3>
                <button
                  type="button"
                  className="min-h-11 text-xs text-[var(--accent)]"
                  onClick={async () => {
                    const name = window.prompt('Name this meal');
                    if (name)
                      await saveMeal(
                        name,
                        items.map((i) => ({
                          name: i.name,
                          kcal: i.kcal / i.qty,
                          protein: i.protein / i.qty,
                          carbs: i.carbs / i.qty,
                          fat: i.fat / i.qty,
                          qty: i.qty,
                        })),
                      ).catch((e) => setError(friendly(e)));
                    await load();
                  }}
                >
                  Save as meal
                </button>
              </div>
              <ul className="grid gap-1">
                {items.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {e.name}
                      {e.qty !== 1 ? ` ×${e.qty}` : ''}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="font-mono text-xs">{Math.round(e.kcal)}</span>
                      <button
                        type="button"
                        aria-label={`Save ${e.name} as a food`}
                        className="min-h-11 min-w-8 text-xs text-[var(--ink-soft)]"
                        onClick={() =>
                          saveFood({
                            name: e.name,
                            kcal: e.kcal / e.qty,
                            protein: e.protein / e.qty,
                            carbs: e.carbs / e.qty,
                            fat: e.fat / e.qty,
                          }).catch(() => undefined)
                        }
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${e.name}`}
                        className="min-h-11 min-w-8 text-[var(--ink-soft)]"
                        onClick={() => deleteLog(e.id).then(load)}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {log && !log.entries.length && (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Nothing logged yet today.</p>
        )}
      </GlassCard>
    </div>
  );
}
