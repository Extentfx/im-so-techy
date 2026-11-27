import { useCallback, useEffect, useState } from 'react';
import {
  decideProposal,
  dismissEmail,
  friendly,
  getDigest,
  ingestEmail,
  type DigestItem,
} from '../lib/api';
import { fmtWhen } from '../lib/week';
import { useError } from '../lib/useError';
import { GlassButton, GlassCard } from '../components/Glass';

const inputCls =
  'min-h-11 w-full min-w-0 rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';
const CAT_COLOR: Record<string, string> = {
  school: '#f2a33a',
  work: '#5b7cff',
  family: '#2fbf8a',
  bills: '#e0586f',
  other: '#8a93b8',
};

export function Inbox() {
  const [items, setItems] = useState<DigestItem[]>([]);
  const [error, setError] = useError();
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getDigest());
    } catch (e) {
      setError(friendly(e));
    }
  }, [setError]);
  useEffect(() => void load(), [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await ingestEmail({ from, subject, body });
      setNote(
        `Filed under ${r.category}${r.proposals ? `, with ${r.proposals} suggested event${r.proposals > 1 ? 's' : ''}` : ''}.`,
      );
      setFrom('');
      setSubject('');
      setBody('');
      await load();
    } catch (er) {
      setError(friendly(er));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Inbox</h1>
      </header>
      {error && (
        <GlassCard role="alert" className="text-sm">
          {error}
        </GlassCard>
      )}

      <GlassCard aria-label="Add an email" className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">Add an email</h2>
        <p className="text-sm text-[var(--ink-soft)]">
          Paste a message and it is sorted into school, work, family or bills, summarised, and any
          dates become suggested events. Only a short summary is kept, never the full message, and
          nothing is added to your calendar until you tap.
        </p>
        <form onSubmit={submit} className="grid gap-2">
          <input
            aria-label="From"
            className={inputCls}
            placeholder="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            aria-label="Subject"
            className={inputCls}
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            aria-label="Message"
            className={`${inputCls} min-h-28 py-2`}
            placeholder="Paste the message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <GlassButton
            type="submit"
            variant="solid"
            disabled={busy || !body.trim()}
            className="justify-self-end"
          >
            {busy ? 'Reading…' : 'Add to inbox'}
          </GlassButton>
        </form>
        {note && (
          <p role="status" className="text-sm text-[var(--ok)]">
            {note}
          </p>
        )}
        <p className="text-xs text-[var(--ink-soft)]">
          Automatic Gmail reading (read-only) needs a Google sign-in and is not connected yet.
        </p>
      </GlassCard>

      {items.length === 0 ? (
        <GlassCard className="text-sm text-[var(--ink-soft)]">No emails yet.</GlassCard>
      ) : (
        items.map((it) => (
          <GlassCard key={it.id} aria-label={it.subject} className="grid gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--ink-soft)]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: CAT_COLOR[it.category] }}
                    aria-hidden="true"
                  />
                  {it.category}
                </p>
                <p className="truncate font-medium">{it.subject}</p>
                <p className="truncate text-xs text-[var(--ink-soft)]">{it.sender}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissEmail(it.id).then(load)}
                className="min-h-11 shrink-0 px-2 text-sm text-[var(--ink-soft)]"
              >
                Dismiss
              </button>
            </div>
            <p className="text-sm">{it.summary}</p>
            {it.proposals.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--glass-fill-strong)] p-3 text-sm"
              >
                <div className="min-w-0 basis-44 flex-1">
                  <p className="font-medium">{p.payload.title}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {p.payload.allDay
                      ? new Date(`${p.payload.start}T12:00:00`).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        }) + ', all day'
                      : fmtWhen(p.payload.start, p.payload.end)}
                  </p>
                </div>
                {p.status === 'pending' ? (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        decideProposal(p.id, 'approve').then(load, (e) => setError(friendly(e)))
                      }
                      className="min-h-11 rounded-full bg-[var(--accent)] px-4 text-white"
                    >
                      Add to calendar
                    </button>
                    <button
                      type="button"
                      onClick={() => decideProposal(p.id, 'reject').then(load)}
                      className="min-h-11 px-3 text-[var(--ink-soft)]"
                    >
                      Skip
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--ink-soft)]">{p.status}</span>
                )}
              </div>
            ))}
          </GlassCard>
        ))
      )}
    </div>
  );
}
