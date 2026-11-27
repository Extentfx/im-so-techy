import { useState, type FormEvent } from 'react';
import type { CalendarSource, SourceKind } from '@life/shared';
import { addSource, friendly, removeSource, syncSource } from '../lib/api';
import { KIND_COLOR, KIND_LABEL } from '../lib/week';
import { Choice, TextField } from '../components/Fields';
import { GlassButton } from '../components/Glass';

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};

export function Sources({
  sources,
  onChange,
}: {
  sources: CalendarSource[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(sources.length === 0);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SourceKind>('work');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('add');
    setMsg(null);
    try {
      const r = await addSource({ name, kind, url });
      setMsg(r.error ? `Added, but the first sync failed: ${r.error}` : null);
      if (!r.error) {
        setName('');
        setUrl('');
        setAdding(false);
      }
      onChange();
    } catch (err) {
      setMsg(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg(friendly(err));
    } finally {
      setBusy(null);
      setConfirm(null);
      onChange();
    }
  };

  return (
    <section
      className="glass-dark grid grid-cols-[minmax(0,1fr)] gap-4 rounded-3xl p-5"
      aria-label="Calendars"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">Calendars</h2>
        {!adding && (
          <GlassButton onClick={() => setAdding(true)} className="!min-h-10">
            Add
          </GlassButton>
        )}
      </div>

      {sources.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: KIND_COLOR[s.kind] }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 basis-40 text-sm">
                <p className="truncate font-medium">
                  {s.name}{' '}
                  <span className="font-normal text-[var(--ink-soft)]">· {KIND_LABEL[s.kind]}</span>
                </p>
                <p className="truncate text-xs text-[var(--ink-soft)]">
                  {s.host} · synced {ago(s.lastSyncedAt)}
                </p>
                {s.lastError && <p className="text-xs text-red-300">{s.lastError}</p>}
              </div>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => act(s.id, () => syncSource(s.id))}
                className="min-h-11 px-2 text-sm underline-offset-4 hover:underline disabled:opacity-50"
              >
                {busy === s.id ? 'Syncing…' : 'Sync'}
              </button>
              <button
                type="button"
                onClick={() =>
                  confirm === s.id ? act(s.id, () => removeSource(s.id)) : setConfirm(s.id)
                }
                className="min-h-11 px-2 text-sm text-red-300 underline-offset-4 hover:underline"
              >
                {confirm === s.id ? 'Really remove?' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-sm text-[var(--ink-soft)]">
            Paste a calendar link (an .ics or webcal:// address). In Google Calendar it is the
            “Secret address in iCal format” under the calendar’s settings; in Outlook, publish the
            calendar and copy the ICS link. We only read it, and the link is stored encrypted.
          </p>
          <TextField
            label="Name"
            value={name}
            maxLength={60}
            placeholder="e.g. Hospital shifts"
            onChange={(e) => setName(e.target.value)}
          />
          <Choice
            label="What is it?"
            value={kind}
            options={(['work', 'school', 'family'] as const).map((k) => ({
              value: k,
              label: KIND_LABEL[k],
            }))}
            onChange={setKind}
          />
          <TextField
            label="Calendar link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            placeholder="https://… or webcal://…"
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            {sources.length > 0 && (
              <GlassButton onClick={() => setAdding(false)}>Cancel</GlassButton>
            )}
            <GlassButton
              type="submit"
              variant="solid"
              disabled={!name.trim() || !url.trim() || busy === 'add'}
            >
              {busy === 'add' ? 'Adding…' : 'Add calendar'}
            </GlassButton>
          </div>
        </form>
      )}

      {msg && (
        <p role="status" className="text-sm text-red-300">
          {msg}
        </p>
      )}
      <p className="text-xs text-[var(--ink-soft)]">
        Google and Outlook sign-in (so the app can also write to its own Dashboard calendar) comes
        next. Links work now.
      </p>
    </section>
  );
}
