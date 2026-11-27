import { useEffect, useRef, useState } from 'react';
import { decideProposal, friendly } from '../lib/api';
import { chatStatus, proposeSlot, streamChat, type ChatEvent } from '../lib/chatApi';
import { fmtWhen } from '../lib/week';
import { GlassButton, GlassCard } from '../components/Glass';

interface Card {
  kind: 'suggest' | 'proposal';
  id?: string;
  title: string;
  start: string;
  end: string;
  state?: 'done' | 'skipped';
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  cards?: Card[];
}

const EXAMPLES = [
  'Can I fit legs tomorrow?',
  'Am I under on protein today?',
  'What did my school email change this week?',
  "What's on this week?",
];
const inputCls =
  'min-h-11 w-full min-w-0 rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<{ claude: boolean; spentUsd: number; capUsd: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatStatus().then(setMode, () => undefined);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs]);

  const patchLast = (f: (m: Msg) => Msg) =>
    setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? f(m) : m)));

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const history: Msg[] = [...msgs, { role: 'user', text: q }];
    setMsgs([...history, { role: 'assistant', text: '' }]);
    const onEvent = (e: ChatEvent) => {
      if (e.type === 'text') patchLast((m) => ({ ...m, text: m.text + (e.text ?? '') }));
      else if (e.type === 'tool')
        patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), e.name ?? ''] }));
      else if ((e.type === 'proposal' || e.type === 'suggest') && e.title && e.start && e.end) {
        const card: Card = { kind: e.type, id: e.id, title: e.title, start: e.start, end: e.end };
        patchLast((m) => ({ ...m, cards: [...(m.cards ?? []), card] }));
      } else if (e.type === 'error') setError(e.message ?? 'Something went wrong.');
    };
    try {
      await streamChat(
        history.map((m) => ({ role: m.role, content: m.text })).filter((m) => m.content),
        onEvent,
      );
    } catch (er) {
      setError(friendly(er));
    } finally {
      setBusy(false);
      void chatStatus().then(setMode, () => undefined);
    }
  };

  const setCard = (mi: number, ci: number, patch: Partial<Card>) =>
    setMsgs((all) =>
      all.map((m, i) =>
        i === mi ? { ...m, cards: m.cards!.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : m,
      ),
    );

  const accept = async (mi: number, ci: number, c: Card) => {
    try {
      if (c.kind === 'proposal' && c.id) await decideProposal(c.id, 'approve');
      else await proposeSlot({ title: c.title, start: c.start, end: c.end });
      setCard(mi, ci, { state: 'done' });
    } catch (er) {
      setError(friendly(er));
    }
  };
  const skip = async (mi: number, ci: number, c: Card) => {
    if (c.kind === 'proposal' && c.id) await decideProposal(c.id, 'reject').catch(() => undefined);
    setCard(mi, ci, { state: 'skipped' });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Chat</h1>
        {mode && (
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            {mode.claude
              ? 'Claude is connected, $' +
                mode.spentUsd.toFixed(2) +
                ' of $' +
                mode.capUsd.toFixed(2) +
                ' used today.'
              : 'Built-in answers from your own data. Add a Claude API key to the Worker for open-ended questions.'}{' '}
            Read-only: anything it suggests needs your tap.
          </p>
        )}
      </header>

      <GlassCard aria-label="Conversation" className="grid gap-3">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <GlassButton key={e} className="!min-h-10 text-left" onClick={() => send(e)}>
                {e}
              </GlassButton>
            ))}
          </div>
        )}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-live="polite">
          {msgs.map((m, mi) => (
            <li
              key={mi}
              className={
                m.role === 'user'
                  ? 'justify-self-end rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm text-white'
                  : 'grid gap-2 text-sm'
              }
            >
              {m.role === 'assistant' && !m.text && busy && mi === msgs.length - 1 ? (
                <span className="text-[var(--ink-soft)]">
                  Thinking
                  {m.tools?.length ? ', checking ' + m.tools.at(-1)!.replace(/_/g, ' ') : '…'}
                </span>
              ) : (
                <p className="whitespace-pre-wrap">{m.text}</p>
              )}
              {m.cards?.map((c, ci) => (
                <div
                  key={ci}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--glass-fill-strong)] p-3"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="font-medium">{c.title}</p>
                    <p className="text-xs text-[var(--ink-soft)]">{fmtWhen(c.start, c.end)}</p>
                  </div>
                  {c.state ? (
                    <span className="text-xs text-[var(--ink-soft)]">
                      {c.state === 'done'
                        ? c.kind === 'proposal'
                          ? 'Added to your calendar'
                          : 'Suggestion saved in Train'
                        : 'Skipped'}
                    </span>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="min-h-11 rounded-full bg-[var(--accent)] px-4 text-white"
                        onClick={() => accept(mi, ci, c)}
                      >
                        {c.kind === 'proposal' ? 'Add to calendar' : 'Suggest this'}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 px-3 text-[var(--ink-soft)]"
                        onClick={() => skip(mi, ci, c)}
                      >
                        Skip
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
        <div ref={end} />
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            aria-label="Message"
            className={inputCls}
            placeholder="Ask about your day…"
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
          />
          <GlassButton type="submit" variant="solid" disabled={busy || !input.trim()}>
            Send
          </GlassButton>
        </form>
      </GlassCard>
    </div>
  );
}
