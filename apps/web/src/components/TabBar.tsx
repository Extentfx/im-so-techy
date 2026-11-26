import { TABS, type TabId } from '@life/shared';

const LABEL: Record<TabId, string> = {
  today: 'Today',
  plan: 'Plan',
  train: 'Train',
  fuel: 'Fuel',
  sleep: 'Sleep',
  home: 'Home',
  inbox: 'Inbox',
};

export function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-3 bottom-3 z-20 mx-auto flex max-w-xl justify-between rounded-full p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
    >
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          aria-current={t === active ? 'page' : undefined}
          onClick={() => onChange(t)}
          className={`min-h-11 flex-1 rounded-full px-1 text-[11px] font-medium transition sm:text-sm ${
            t === active
              ? 'bg-[var(--glass-fill-strong)] text-[var(--ink)]'
              : 'text-[var(--ink-soft)]'
          } focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
        >
          {LABEL[t]}
        </button>
      ))}
    </nav>
  );
}
