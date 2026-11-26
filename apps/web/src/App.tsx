import { useState } from 'react';
import type { TabId } from '@life/shared';
import { Backdrop } from './components/Backdrop';
import { GlassButton } from './components/Glass';
import { Sheet } from './components/Sheet';
import { TabBar } from './components/TabBar';
import { Today } from './screens/Today';
import { Placeholder } from './screens/Placeholder';

export function App() {
  const [tab, setTab] = useState<TabId>('today');
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      <Backdrop />
      <main className="mx-auto min-h-full max-w-3xl px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))]">
        {tab === 'today' ? <Today /> : <Placeholder tab={tab} />}
      </main>
      <GlassButton
        variant="solid"
        aria-label="Open chat"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-24 right-4 z-20 !h-14 !w-14 !px-0 text-xl"
      >
        ✦
      </GlassButton>
      <Sheet open={chatOpen} title="Ask your dashboard" onClose={() => setChatOpen(false)}>
        <p className="text-sm text-[var(--ink-soft)]">
          The chat arrives in Phase 6. It will be read-only by default; any action will need your
          tap.
        </p>
      </Sheet>
      <TabBar active={tab} onChange={setTab} />
    </>
  );
}
