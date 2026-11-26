import type { CalEvent } from '@life/shared';
import { fmtRange, KIND_COLOR, KIND_LABEL } from '../lib/week';

export function EventRow({ e }: { e: CalEvent }) {
  return (
    <li className="flex gap-3">
      <span
        role="img"
        aria-label={KIND_LABEL[e.kind]}
        className="mt-1 w-1 shrink-0 self-stretch rounded-full"
        style={{ background: KIND_COLOR[e.kind] }}
      />
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">{e.title}</p>
        <p className="text-xs text-[var(--ink-soft)]">
          {fmtRange(e)}
          {e.location ? ` · ${e.location}` : ''}
        </p>
      </div>
    </li>
  );
}
