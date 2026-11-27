import { useEffect, useState } from 'react';
import type { Profile, TabId } from '@life/shared';
import { Backdrop } from './components/Backdrop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RadialNav } from './components/RadialNav';
import { getProfile, putProfile } from './lib/api';
import { loadLocalProfile, saveLocalProfile } from './lib/profile';
import { Chat } from './screens/Chat';
import { Connections } from './screens/Connections';
import { Fuel } from './screens/Fuel';
import { Home } from './screens/Home';
import { Inbox } from './screens/Inbox';
import { Onboarding } from './screens/Onboarding';
import { Family } from './screens/Family';
import { Plan } from './screens/Plan';
import { Settings } from './screens/Settings';
import { Sleep } from './screens/Sleep';
import { Today } from './screens/Today';
import { Train } from './screens/Train';

export function App() {
  // The read-only family page needs no profile, no login and no backdrop.
  if (window.location.pathname === '/family') return <Family />;
  return <Dashboard />;
}

const CONNECT_ERRORS: Record<string, string> = {
  invalid_state: 'That sign-in link expired. Please try again.',
  denied: 'Sign-in was cancelled, so nothing was connected.',
  failed: 'Sign-in did not complete. Please try again.',
  no_refresh_token:
    'The provider did not grant long-term access. Remove this app in your account permissions, then connect again.',
};

/** Reads the ?connected= or ?connect_error= left by the provider's redirect. Pure, so React may call it twice. */
function readConnectResult(): { ok: boolean; text: string } | null {
  const q = new URLSearchParams(window.location.search);
  const ok = q.get('connected');
  const bad = q.get('connect_error');
  if (ok)
    return {
      ok: true,
      text: `${ok === 'google' ? 'Google' : 'Microsoft'} connected. Choose what to import below.`,
    };
  if (bad) return { ok: false, text: CONNECT_ERRORS[bad] ?? 'Sign-in did not complete.' };
  return null;
}

function Dashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [connectResult] = useState(readConnectResult);
  const [tab, setTab] = useState<TabId>(connectResult ? 'connect' : 'today');
  useEffect(() => {
    if (connectResult) window.history.replaceState({}, '', '/');
  }, [connectResult]);

  // The server is the source of truth. A browser copy is the fallback, and seeds the server once.
  useEffect(() => {
    getProfile().then(
      async ({ profile: p, exists }) => {
        const local = loadLocalProfile();
        if (!exists && local.completed) {
          await putProfile(local).catch(() => undefined);
          setProfile(local);
        } else {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const fixed =
            p.completed && p.timezone === 'UTC' && tz && tz !== 'UTC' ? { ...p, timezone: tz } : p;
          if (fixed !== p) void putProfile(fixed).catch(() => undefined);
          setProfile(fixed);
          saveLocalProfile(fixed);
        }
      },
      () => setProfile(loadLocalProfile()),
    );
  }, []);

  const save = (p: Profile) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (p.completed && p.timezone === 'UTC' && tz) p = { ...p, timezone: tz };
    saveLocalProfile(p);
    setProfile(p);
    void putProfile(p).catch(() => undefined);
  };

  if (!profile) return null;

  if (!profile.completed || editing) {
    return (
      <Onboarding
        initial={profile}
        onDone={(p) => {
          save(p);
          setEditing(false);
        }}
        onCancel={profile.completed ? () => setEditing(false) : undefined}
        startAt={connectResult ? 'connect' : undefined}
        notice={connectResult}
      />
    );
  }

  return (
    <>
      <Backdrop />
      <main className="mx-auto min-h-full max-w-3xl px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <ErrorBoundary key={tab}>
          {tab === 'today' ? (
            <Today profile={profile} onEditSetup={() => setEditing(true)} />
          ) : tab === 'plan' ? (
            <Plan />
          ) : tab === 'train' ? (
            <Train profile={profile} />
          ) : tab === 'fuel' ? (
            <Fuel profile={profile} />
          ) : tab === 'sleep' ? (
            <Sleep profile={profile} />
          ) : tab === 'inbox' ? (
            <Inbox />
          ) : tab === 'home' ? (
            <Home />
          ) : tab === 'chat' ? (
            <Chat />
          ) : tab === 'connect' ? (
            <Connections onNavigate={setTab} notice={connectResult} />
          ) : (
            <Settings profile={profile} onSave={save} onRedoSetup={() => setEditing(true)} />
          )}
        </ErrorBoundary>
      </main>
      <RadialNav active={tab} onSelect={setTab} />
    </>
  );
}
