import { useState } from 'react';
import type { Profile, TabId } from '@life/shared';
import { Backdrop } from './components/Backdrop';
import { loadProfile, saveProfile } from './lib/profile';
import { RadialNav } from './components/RadialNav';
import { Onboarding } from './screens/Onboarding';
import { Placeholder } from './screens/Placeholder';
import { Today } from './screens/Today';

export function App() {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<TabId>('today');

  const done = (p: Profile) => {
    saveProfile(p);
    setProfile(p);
    setEditing(false);
  };

  if (!profile.completed || editing) {
    return (
      <Onboarding
        initial={profile}
        onDone={done}
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
        ) : (
          <Placeholder tab={tab} />
        )}
      </main>
      <RadialNav active={tab} onSelect={setTab} />
    </>
  );
}
