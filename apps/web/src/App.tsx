import { useState } from 'react';
import type { Profile } from '@life/shared';
import { Backdrop } from './components/Backdrop';
import { loadProfile, saveProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';

export function App() {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [editing, setEditing] = useState(false);

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
      <main className="mx-auto min-h-full max-w-3xl px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Today profile={profile} onEditSetup={() => setEditing(true)} />
      </main>
    </>
  );
}
