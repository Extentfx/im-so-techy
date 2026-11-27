import { useCallback, useEffect, useState } from 'react';
import type { TabId } from '@life/shared';
import {
  addRemoteCalendar,
  checkMailNow,
  disconnectAccount,
  friendly,
  getConnections,
  getConnectors,
  listRemoteCalendars,
  setMailAuto,
  setMirror,
  startOAuth,
  type Connection,
  type ConnectorStatus,
  type Feature,
  type Provider,
  type ProviderInfo,
  type RemoteCalendar,
} from '../lib/api';
import { useError } from '../lib/useError';

const ABOUT: Record<Provider, { name: string; what: string; steps: string[]; link: string }> = {
  google: {
    name: 'Google',
    what: 'Gmail (read-only) and Google Calendar. Dates in new email become suggestions you approve, and your calendars appear on Plan.',
    link: 'console.cloud.google.com',
    steps: [
      'In Google Cloud Console, create a project and turn on the Gmail API and Google Calendar API.',
      'Create an OAuth client of type "Web application" and add the redirect address below.',
      'Add the client ID and secret to the server as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the README).',
      'While the app is in "Testing", Google ends the sign-in after about 7 days. Move it to production (for yourself only) to avoid that.',
    ],
  },
  microsoft: {
    name: 'Microsoft',
    what: 'Outlook mail (read-only) and Outlook calendars, for personal and work accounts.',
    link: 'entra.microsoft.com',
    steps: [
      'In Microsoft Entra, register an app (accounts in any directory and personal accounts).',
      'Add a "Web" redirect with the address below, and create a client secret.',
      'Add the app ID and secret to the server as MS_CLIENT_ID and MS_CLIENT_SECRET (see the README).',
    ],
  },
};

const btn =
  'min-h-11 rounded-full px-5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const solid = `${btn} bg-[var(--accent)] text-white disabled:opacity-50`;
const soft = `${btn} border border-[var(--glass-border)] bg-[var(--glass-fill-strong)]`;
const row = 'grid gap-3 rounded-2xl bg-[var(--glass-fill-strong)] p-4';
const ago = (iso: string | null) => {
  if (!iso) return 'not yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};

function AccountCard({
  c,
  mirrorOn,
  onChange,
  onReconnect,
}: {
  c: Connection;
  mirrorOn: boolean;
  onChange: () => void;
  onReconnect: (f: Feature[]) => void;
}) {
  const [calendars, setCalendars] = useState<RemoteCalendar[] | null>(null);
  const [kind, setKind] = useState<'work' | 'school' | 'family'>('family');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useError();
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState(c.mailEnabled);
  const [mirror, setMirrorState] = useState(mirrorOn);
  useEffect(() => setMail(c.mailEnabled), [c.mailEnabled]);
  useEffect(() => setMirrorState(mirrorOn), [mirrorOn]);
  /** Runs an action; returns whether it worked, so a tick box can change instantly and undo itself if it did not. */
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    let worked = true;
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      worked = false;
      setError(friendly(e));
    } finally {
      setBusy(false);
      onChange();
    }
    return worked;
  };
  const hasMail = c.features.includes('mail');
  const hasCal = c.features.includes('calendar');

  return (
    <li className={row}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{c.account}</p>
          <p className="text-xs text-[var(--ink-soft)]">
            {ABOUT[c.provider].name} ·{' '}
            {c.features
              .map((f) => (f === 'mail' ? 'email (read-only)' : 'calendars'))
              .join(' and ')}
          </p>
        </div>
        {c.status === 'needs_reconnect' ? (
          <button type="button" className={solid} onClick={() => onReconnect(c.features)}>
            Sign in again
          </button>
        ) : (
          <span className="rounded-full bg-[var(--ok)]/20 px-3 py-1 text-xs">Connected</span>
        )}
      </div>
      {c.status === 'needs_reconnect' && (
        <p className="text-sm">{c.error ?? 'Sign in again to keep this connected.'}</p>
      )}

      {hasMail && c.status === 'ok' && (
        <div className="grid gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mail}
              disabled={busy}
              onChange={async (e) => {
                const v = e.target.checked;
                setMail(v);
                if (!(await run(() => setMailAuto(c.id, v)))) setMail(!v);
              }}
            />
            Check this inbox automatically every 15 minutes
          </label>
          <p className="text-xs text-[var(--ink-soft)]">
            Last checked {ago(c.mailLastChecked)}. Only a short summary is kept, never the message,
            and nothing reaches your calendar until you tap.
          </p>
          {c.mailError && <p className="text-xs text-red-400">Last check failed: {c.mailError}</p>}
          <div>
            <button
              type="button"
              className={soft}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await checkMailNow(c.id);
                  setMsg(
                    `Read ${r.processed} new email${r.processed === 1 ? '' : 's'}, ${r.proposals} suggested event${r.proposals === 1 ? '' : 's'}.`,
                  );
                })
              }
            >
              {busy ? 'Checking…' : 'Check now'}
            </button>
          </div>
        </div>
      )}

      {hasCal && c.status === 'ok' && (
        <div className="grid gap-2">
          {calendars === null ? (
            <div>
              <button
                type="button"
                className={soft}
                disabled={busy}
                onClick={() => run(async () => setCalendars(await listRemoteCalendars(c.id)))}
              >
                Choose calendars to import
              </button>
            </div>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Import as</legend>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Kind of calendar">
                {(['work', 'school', 'family'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={`${btn} capitalize ${kind === k ? 'bg-[var(--accent)] text-white' : 'border border-[var(--glass-border)]'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <ul className="grid gap-1">
                {calendars.map((cal) => (
                  <li
                    key={cal.id}
                    className="flex min-h-11 items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{cal.name}</span>
                    {cal.added ? (
                      <span className="text-xs text-[var(--ink-soft)]">Imported</span>
                    ) : (
                      <button
                        type="button"
                        className={soft}
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await addRemoteCalendar(c.id, {
                              remoteId: cal.id,
                              name: cal.name,
                              kind,
                            });
                            setCalendars(await listRemoteCalendars(c.id));
                          }, `Imported ${cal.name}. It now shows on Plan.`)
                        }
                      >
                        Import
                      </button>
                    )}
                  </li>
                ))}
                {calendars.length === 0 && (
                  <li className="text-sm text-[var(--ink-soft)]">No calendars found.</li>
                )}
              </ul>
              <button
                type="button"
                className="min-h-11 justify-self-start text-sm text-[var(--accent-text)]"
                onClick={() => setCalendars(null)}
              >
                Close
              </button>
            </fieldset>
          )}
          {c.provider === 'google' && (
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={mirror}
                disabled={busy}
                onChange={async (e) => {
                  const v = e.target.checked;
                  setMirrorState(v);
                  if (!(await run(() => setMirror(c.id, v)))) setMirrorState(!v);
                }}
              />
              <span>
                Also keep a "Life Dashboard" calendar in Google
                <span className="block text-xs text-[var(--ink-soft)]">
                  Events you approve are copied there. It can only touch the calendar this app
                  creates, never your others.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {msg && (
        <p role="status" className="text-sm text-[var(--ok)]">
          {msg}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div>
        <button
          type="button"
          className="min-h-11 text-sm text-red-400 underline-offset-4 hover:underline"
          disabled={busy}
          onClick={() =>
            window.confirm(
              `Disconnect ${c.account}? Its imported calendars are removed from here. Your own data stays.`,
            ) && run(() => disconnectAccount(c.id))
          }
        >
          Disconnect
        </button>
      </div>
    </li>
  );
}

function ProviderCard({
  info,
  accounts,
  mirrorId,
  onChange,
  beforeRedirect,
}: {
  info: ProviderInfo;
  accounts: Connection[];
  mirrorId: string | null;
  onChange: () => void;
  beforeRedirect?: () => Promise<void>;
}) {
  const about = ABOUT[info.provider];
  const [features, setFeatures] = useState<Feature[]>(['mail', 'calendar']);
  const [error, setError] = useError();
  const [busy, setBusy] = useState(false);

  const go = async (f: Feature[]) => {
    setBusy(true);
    setError(null);
    try {
      await beforeRedirect?.();
      const { url } = await startOAuth(info.provider, f);
      window.location.assign(url); // the provider's own sign-in page; we never see your password
    } catch (e) {
      setError(friendly(e));
      setBusy(false);
    }
  };
  const toggle = (f: Feature) =>
    setFeatures((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <section aria-label={about.name} className={row}>
      <div>
        <h3 className="font-display text-2xl">{about.name}</h3>
        <p className="text-sm text-[var(--ink-soft)]">{about.what}</p>
      </div>
      {accounts.length > 0 && (
        <ul className="grid gap-3">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              c={a}
              mirrorOn={mirrorId === a.id}
              onChange={onChange}
              onReconnect={go}
            />
          ))}
        </ul>
      )}
      {info.configured ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">
            {accounts.length ? 'Connect another account' : `Connect ${about.name}`}
          </legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={features.includes('mail')}
              onChange={() => toggle('mail')}
            />
            Email, read-only (never sends, deletes or changes anything)
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={features.includes('calendar')}
              onChange={() => toggle('calendar')}
            />
            Calendars
          </label>
          <div>
            <button
              type="button"
              className={solid}
              disabled={busy || features.length === 0}
              onClick={() => go(features)}
            >
              {busy ? 'Opening…' : `Connect ${about.name}`}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
        </fieldset>
      ) : (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            Not set up on this server yet. Show the steps
          </summary>
          <ol className="ml-5 mt-2 grid list-decimal gap-1 text-[var(--ink-soft)]">
            {about.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-[var(--ink-soft)]">Redirect address to register:</p>
          <p className="break-all rounded-lg bg-black/10 px-2 py-1 font-mono text-xs select-all">
            {info.redirectUri}
          </p>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            Create the app at {about.link}. Restart the server after adding the keys.
          </p>
        </details>
      )}
    </section>
  );
}

function Simple({
  title,
  body,
  state,
  action,
  onClick,
}: {
  title: string;
  body: string;
  state: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <li className={`${row} sm:grid-cols-[1fr_auto] sm:items-center`}>
      <div className="min-w-0">
        <p className="font-medium">
          {title}{' '}
          <span className="ml-1 rounded-full bg-black/10 px-2 py-0.5 text-xs font-normal">
            {state}
          </span>
        </p>
        <p className="text-sm text-[var(--ink-soft)]">{body}</p>
      </div>
      {action && onClick && (
        <button type="button" className={soft} onClick={onClick}>
          {action}
        </button>
      )}
    </li>
  );
}

/**
 * Everything the app can connect to, in one place. Used on the Connect page and as an onboarding step.
 * `beforeRedirect` lets onboarding save its answers before the browser leaves for Google or Microsoft.
 */
export function Connectors({
  onNavigate,
  beforeRedirect,
  notice,
}: {
  onNavigate?: (t: TabId) => void;
  beforeRedirect?: () => Promise<void>;
  notice?: { ok: boolean; text: string } | null;
}) {
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [accounts, setAccounts] = useState<Connection[]>([]);
  const [mirror, setMirrorId] = useState<string | null>(null);
  const [error, setError] = useError();

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([getConnectors(), getConnections()]);
      setStatus(s);
      setAccounts(c.connections);
      setMirrorId(c.mirror);
    } catch (e) {
      setError(friendly(e));
    }
  }, [setError]);
  useEffect(() => void load(), [load]);

  return (
    <div className="grid gap-5">
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`rounded-2xl p-3 text-sm ${notice.ok ? 'bg-[var(--ok)]/20' : 'bg-red-500/20'}`}
        >
          {notice.text}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
          Email and calendars
        </h2>
        {status?.providers.map((p) => (
          <ProviderCard
            key={p.provider}
            info={p}
            accounts={accounts.filter((a) => a.provider === p.provider)}
            mirrorId={mirror}
            onChange={load}
            beforeRedirect={beforeRedirect}
          />
        ))}
        {!status && !error && <p className="text-sm text-[var(--ink-soft)]">Loading…</p>}
      </div>

      {status && (
        <>
          <div className="grid gap-3">
            <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
              More ways to connect
            </h2>
            <ul className="grid gap-3">
              <Simple
                title="Calendar links"
                state={status.calendarLinks ? `${status.calendarLinks} linked` : 'none yet'}
                body="Any calendar that can share an .ics or webcal address, including school and work systems."
                action="Manage"
                onClick={onNavigate ? () => onNavigate('plan') : undefined}
              />
              <Simple
                title="Home Assistant"
                state={status.home ? 'connected' : 'not connected'}
                body="Lights, thermostat, plugs and scenes. Locks and garage doors always ask first."
                action={status.home ? 'Manage' : 'Set up'}
                onClick={onNavigate ? () => onNavigate('home') : undefined}
              />
              <Simple
                title="Phone notifications"
                state={status.notifications ? 'on' : 'off'}
                body="Shift changes, new events found in email, and a bedtime reminder, through ntfy."
                action={status.notifications ? 'Manage' : 'Set up'}
                onClick={onNavigate ? () => onNavigate('settings') : undefined}
              />
              <Simple
                title="Sleep from a phone or wearable"
                state={status.server.serviceToken ? 'ready' : 'needs a service token'}
                body="An iOS Shortcut or wearable can post nightly sleep. It uses a Cloudflare Access service token that can reach that one address only. The README has the steps."
              />
            </ul>
          </div>
          <div className="grid gap-3">
            <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
              Set up on the server
            </h2>
            <ul className="grid gap-3">
              <Simple
                title="Claude for chat and email labels"
                state={status.server.claude ? 'on' : 'off'}
                body={
                  status.server.claude
                    ? 'Open-ended chat is on, with a daily spending cap.'
                    : 'Chat still works with built-in answers. Add ANTHROPIC_API_KEY on the server for open-ended questions.'
                }
              />
              <Simple
                title="Food database"
                state={status.server.usdaKey ? 'your USDA key' : 'shared demo key'}
                body="Food search uses Open Food Facts and USDA. A free USDA key (FDC_API_KEY) avoids the shared rate limit."
              />
              <Simple
                title="Nightly backups"
                state={status.server.backups ? 'on' : 'off'}
                body="Encrypted copies kept for two weeks in your own Cloudflare storage. You can always download one by hand under You."
              />
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
