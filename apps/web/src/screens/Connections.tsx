import type { TabId } from '@life/shared';
import { Connectors } from '../components/Connectors';

export function Connections({
  onNavigate,
  notice,
}: {
  onNavigate: (t: TabId) => void;
  notice: { ok: boolean; text: string } | null;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Connect</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Connect your accounts and the app does the checking for you. It only reads email and
          calendars, and anything it wants to add waits for your tap.
        </p>
      </header>
      <Connectors onNavigate={onNavigate} notice={notice} />
    </div>
  );
}
