/** Who or what caused a write. Every write to a calendar or device is audited with one of these. */
export type AuditSource = 'user' | 'chat' | 'scheduler';

/** Anything the scheduler, email reader or chat wants to do. Nothing runs until status is 'approved'. */
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Proposal {
  id: string;
  source: AuditSource;
  kind: 'calendar_event' | 'device_action' | 'shift_change';
  summary: string;
  payload: unknown;
  status: ProposalStatus;
  createdAt: string;
}

export interface HealthResponse {
  ok: true;
  user: string;
}

export type Units = 'lb' | 'kg';
export type CalendarProvider = 'google' | 'outlook' | 'apple' | 'ics';
export type LunchFor = 'me' | 'kids' | 'both' | 'none';
export type SleepTracker =
  'phone' | 'oura' | 'fitbit' | 'apple-watch' | 'garmin' | 'whoop' | 'none';
export type HomeSystem =
  'home-assistant' | 'hue' | 'homekit' | 'google-home' | 'alexa' | 'smartthings' | 'none';

/** Answers from onboarding. Single owner; later phases move this into D1 settings. */
export interface Profile {
  completed: boolean;
  name: string;
  units: Units;
  calorieTarget: number | null;
  workoutsPerWeek: number;
  calendars: CalendarProvider[];
  shiftsChange: boolean;
  lunchFor: LunchFor;
  sleepTracker: SleepTracker;
  sleepHours: number;
  wakeTime: string; // HH:MM
  homeSystems: HomeSystem[];
}
