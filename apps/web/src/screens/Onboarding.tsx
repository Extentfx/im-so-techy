import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Profile } from '@life/shared';
import { Scenery } from '../components/Scenery';
import { Choice, Multi, TextField } from '../components/Fields';
import { Connectors } from '../components/Connectors';
import { GlassButton } from '../components/Glass';
import { putProfile } from '../lib/api';
import { saveLocalProfile } from '../lib/profile';

interface Step {
  id: string;
  scene: string;
  title: string;
  lead: string;
  valid?: (p: Profile) => boolean;
  body: (p: Profile, set: (patch: Partial<Profile>) => void, ctx: StepContext) => ReactNode;
}

/** What a step may use beyond the answers: saving a draft before leaving for another site, and a message to show. */
interface StepContext {
  saveDraft: () => Promise<void>;
  notice: { ok: boolean; text: string } | null;
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    scene: 'dawn',
    title: 'A calmer week, planned for you.',
    lead: 'A few quick questions so the dashboard fits your life. Everything stays private, and nothing changes your calendar or devices without your tap.',
    body: (p, set) => (
      <TextField
        label="What should we call you?"
        value={p.name}
        maxLength={40}
        autoComplete="given-name"
        placeholder="Your first name"
        onChange={(e) => set({ name: e.target.value })}
      />
    ),
  },
  {
    id: 'body',
    scene: 'forest',
    title: 'Training and food',
    lead: 'This sets your targets. You can change any of it later.',
    body: (p, set) => (
      <div className="grid gap-5">
        <Choice
          label="Units"
          value={p.units}
          options={[
            { value: 'lb', label: 'Pounds' },
            { value: 'kg', label: 'Kilograms' },
          ]}
          onChange={(units) => set({ units })}
        />
        <TextField
          label="Daily calorie target"
          hint="Optional. Leave blank to decide later."
          type="number"
          inputMode="numeric"
          min={800}
          max={6000}
          step={50}
          value={p.calorieTarget ?? ''}
          placeholder="e.g. 2200"
          onChange={(e) =>
            set({ calorieTarget: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
        <Choice
          label="Workouts per week"
          value={String(p.workoutsPerWeek)}
          options={['2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
          onChange={(n) => set({ workoutsPerWeek: Number(n) })}
        />
      </div>
    ),
  },
  {
    id: 'week',
    scene: 'lake',
    title: 'Your week',
    lead: 'Where do your work, school and family calendars live? We only read them; anything we add goes in its own Dashboard calendar.',
    body: (p, set) => (
      <div className="grid gap-5">
        <Multi
          label="Calendars"
          value={p.calendars}
          options={[
            { value: 'google', label: 'Google' },
            { value: 'outlook', label: 'Outlook' },
            { value: 'apple', label: 'Apple' },
            { value: 'ics', label: 'ICS link' },
          ]}
          onChange={(calendars) => set({ calendars })}
        />
        <Choice
          label="Do your work shifts change week to week?"
          value={p.shiftsChange ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          onChange={(v) => set({ shiftsChange: v === 'yes' })}
        />
        <Choice
          label="Whose school lunch should we log?"
          value={p.lunchFor}
          options={[
            { value: 'me', label: 'Mine' },
            { value: 'kids', label: 'My kids’' },
            { value: 'both', label: 'Both' },
            { value: 'none', label: 'Neither' },
          ]}
          onChange={(lunchFor) => set({ lunchFor })}
        />
      </div>
    ),
  },
  {
    id: 'sleep',
    scene: 'night',
    title: 'Sleep',
    lead: 'Sleep shapes your plan: hard sessions step back after a rough night.',
    body: (p, set) => (
      <div className="grid gap-5">
        <Choice
          label="What do you track sleep with?"
          value={p.sleepTracker}
          options={[
            { value: 'phone', label: 'Phone only' },
            { value: 'oura', label: 'Oura' },
            { value: 'fitbit', label: 'Fitbit' },
            { value: 'apple-watch', label: 'Apple Watch' },
            { value: 'garmin', label: 'Garmin' },
            { value: 'whoop', label: 'Whoop' },
            { value: 'none', label: 'Nothing' },
          ]}
          onChange={(sleepTracker) => set({ sleepTracker })}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Hours you aim for"
            type="number"
            inputMode="decimal"
            min={4}
            max={12}
            step={0.5}
            value={p.sleepHours}
            onChange={(e) => set({ sleepHours: Number(e.target.value) })}
          />
          <TextField
            label="Usual wake time"
            type="time"
            value={p.wakeTime}
            onChange={(e) => set({ wakeTime: e.target.value })}
          />
        </div>
      </div>
    ),
  },
  {
    id: 'home',
    scene: 'dusk',
    title: 'Your home',
    lead: 'Optional. Scenes like wind-down lights need a bridge; locks and doors will always ask first.',
    body: (p, set) => (
      <Multi
        label="What do you already use?"
        none="none"
        value={p.homeSystems}
        options={[
          { value: 'home-assistant', label: 'Home Assistant' },
          { value: 'hue', label: 'Philips Hue' },
          { value: 'homekit', label: 'HomeKit' },
          { value: 'google-home', label: 'Google Home' },
          { value: 'alexa', label: 'Alexa' },
          { value: 'smartthings', label: 'SmartThings' },
          { value: 'none', label: 'Nothing yet' },
        ]}
        onChange={(homeSystems) => set({ homeSystems })}
      />
    ),
  },
  {
    id: 'connect',
    scene: 'lake',
    title: 'Connect your accounts',
    lead: 'Optional, and you can do it any time from the Connect page. Connected accounts are read-only: the app reads your email and calendars, and anything it wants to add waits for your tap.',
    body: (_p, _set, ctx) => <Connectors beforeRedirect={ctx.saveDraft} notice={ctx.notice} />,
  },
  {
    id: 'finish',
    scene: 'dawn',
    title: 'You’re set.',
    lead: 'Your answers stay on this device for now. Calendars, sleep and the rest connect in later steps, always behind your login.',
    body: (p) => (
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 text-sm text-[var(--ink-soft)]">
        <li>Private by default: no third-party scripts, no tracking.</li>
        <li>Nothing is added to a calendar or a device until you approve it.</li>
        <li>
          {p.name ? `Welcome, ${p.name}. ` : ''}You can redo this any time from the top of Today.
        </li>
      </ul>
    ),
  },
];

export function Onboarding({
  initial,
  onDone,
  onCancel,
  startAt,
  notice = null,
}: {
  initial: Profile;
  onDone: (p: Profile) => void;
  onCancel?: () => void;
  /** Step id to open first, used when returning from Google or Microsoft sign-in. */
  startAt?: string;
  notice?: { ok: boolean; text: string } | null;
}) {
  const [step, setStep] = useState(() =>
    Math.max(
      0,
      STEPS.findIndex((x) => x.id === startAt),
    ),
  );
  const [profile, setProfile] = useState<Profile>(initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const s = STEPS[step]!;
  const last = step === STEPS.length - 1;

  useEffect(() => heading.current?.focus(), [step]);

  // Going to Google or Microsoft leaves this page, so keep the answers so far and pick up where you left off.
  const saveDraft = async () => {
    const draft = { ...profile, completed: false };
    saveLocalProfile(draft);
    await putProfile(draft).catch(() => undefined);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (s.valid && !s.valid(profile)) return;
    if (last) onDone({ ...profile, completed: true });
    else setStep(step + 1);
  };

  return (
    <>
      <Scenery scene={s.scene} seed={7} step={step} />
      <main className="mx-auto grid min-h-full max-w-xl content-end px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:content-center">
        <form onSubmit={next} className="glass-dark grid gap-6 rounded-3xl p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <ol aria-label={`Step ${step + 1} of ${STEPS.length}`} className="flex gap-1.5">
              {STEPS.map((x, i) => (
                <li
                  key={x.id}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === step ? 28 : 10,
                    background: i <= step ? '#fff' : 'rgb(255 255 255 / 0.3)',
                  }}
                />
              ))}
            </ol>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="min-h-11 px-2 text-sm text-[var(--ink-soft)] underline-offset-4 hover:underline"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="grid gap-2">
            <h1
              ref={heading}
              tabIndex={-1}
              className="font-display text-4xl leading-tight outline-none"
            >
              {s.title}
            </h1>
            <p className="text-sm leading-relaxed text-[var(--ink-soft)]">{s.lead}</p>
          </div>

          <div className="grid gap-5">
            {s.body(profile, (patch) => setProfile((p) => ({ ...p, ...patch })), {
              saveDraft,
              notice,
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            {step > 0 ? (
              <GlassButton onClick={() => setStep(step - 1)}>Back</GlassButton>
            ) : (
              <span />
            )}
            <GlassButton type="submit" variant="solid" className="px-7">
              {last ? 'Open my dashboard' : step === 0 ? 'Get started' : 'Continue'}
            </GlassButton>
          </div>
        </form>
      </main>
    </>
  );
}
