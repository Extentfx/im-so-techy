import { GlassCard } from '../components/Glass';
import { ProgressRing } from '../components/ProgressRing';

const greeting = (h: number) =>
  h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

export function Today() {
  const now = new Date();
  return (
    <div className="grid gap-4">
      <header className="px-1 pt-2">
        <p className="text-sm text-[var(--ink-soft)]">
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="font-display text-5xl italic leading-tight">{greeting(now.getHours())}.</h1>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <GlassCard className="col-span-2 sm:col-span-1">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Schedule</h2>
          <p className="mt-3 font-display text-2xl">Nothing connected yet</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">Calendars arrive in Phase 1.</p>
        </GlassCard>

        <GlassCard className="grid place-items-center">
          <ProgressRing value={0.62} label="Calories" caption="sample value" />
        </GlassCard>

        <GlassCard className="grid place-items-center">
          <ProgressRing value={0.4} label="Workouts" caption="sample value" />
        </GlassCard>

        <GlassCard className="col-span-2">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Sleep</h2>
          <p className="mt-3 font-mono text-3xl">–– h ––m</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">Sleep import arrives in Phase 4.</p>
        </GlassCard>
      </div>
    </div>
  );
}
