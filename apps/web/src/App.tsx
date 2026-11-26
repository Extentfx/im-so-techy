import { useEffect, useState } from 'react';
import type { Profile, TabId } from '@life/shared';
import { Backdrop } from './components/Backdrop';
import { RadialNav } from './components/RadialNav';
import { getProfile, putProfile } from './lib/api';
import { loadLocalProfile, saveLocalProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Placeholder } from './screens/Placeholder';
import { Plan } from './screens/Plan';
import { Today } from './screens/Today';

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<TabId>('today');

  // The server is the source of truth. A browser copy is the fallback, and seeds the server once.
  useEffect(() => {
    getProfile().then(
      async ({ profile: p, exists }) => {
        const local = loadLocalProfile();
        if (!exists && local.completed) {
          await putProfile(local).catch(() => undefined);
          setProfile(local);
        } else {
          setProfile(p);
          saveLocalProfile(p);
        }
      },
      () => setProfile(loadLocalProfile()),
    );
  }, []);

  const save = (p: Profile) => {
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
      />
    );
  }

  return (
    <>
      <Backdrop />
      <main className="mx-auto min-h-full max-w-3xl px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))]">
        {tab === 'today' ? (
          <Today profile={profile} onEditSetup={() => setEditing(true)} />
        ) : tab === 'plan' ? (
          <Plan />
        ) : (
          <Placeholder tab={tab} />
        )}
      </main>
      <RadialNav active={tab} onSelect={setTab} />
    </>
  );
}
