import type { ShiftChange } from '@life/shared';
import { GlassCard } from './Glass';
import { fmtWhen } from '../lib/week';

const VERB = { changed: 'Shift changed', added: 'New shift', removed: 'Shift removed' } as const;

export function ShiftAlerts({
  alerts,
  onDismiss,
}: {
  alerts: ShiftChange[];
  onDismiss: (id: number) => void;
}) {
  if (!alerts.length) return null;
  return (
    <GlassCard aria-label="Shift changes" className="border-[var(--accent)]">
      <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Schedule changed</h2>
      <ul className="mt-3 grid gap-4">
        {alerts.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium">
                {VERB[a.type]}: {a.title}{' '}
                <span className="font-normal text-[var(--ink-soft)]">({a.sourceName})</span>
              </p>
              {a.old && (
                <p
                  className={
                    a.new ? 'text-[var(--ink-soft)] line-through' : 'text-[var(--ink-soft)]'
                  }
                >
                  {fmtWhen(a.old.start, a.old.end)}
                </p>
              )}
              {a.new && <p>{fmtWhen(a.new.start, a.new.end)}</p>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(a.id)}
              className="min-h-11 shrink-0 px-2 text-sm text-[var(--ink-soft)] underline-offset-4 hover:underline"
            >
              Got it
            </button>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
