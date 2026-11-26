import type { TabId } from '@life/shared';
import { GlassCard } from '../components/Glass';

const PHASE: Record<TabId, string> = {
  today: '0',
  plan: '1',
  train: '2',
  fuel: '3',
  sleep: '4',
  home: '7',
  inbox: '5',
  chat: '6',
  settings: '8',
};

export function Placeholder({ tab }: { tab: TabId }) {
  return (
    <GlassCard className="mt-8">
      <h1 className="font-display text-4xl capitalize">{tab}</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Planned for Phase {PHASE[tab]}.</p>
    </GlassCard>
  );
}
