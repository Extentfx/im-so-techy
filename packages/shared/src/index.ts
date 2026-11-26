/** Who or what caused a write. Every write to a calendar or device is audited with one of these. */
export type AuditSource = 'user' | 'chat' | 'scheduler' | 'email';

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

export * from './profile';
export * from './tz';
export * from './exercises';
export * from './gym';
export * from './scheduler';

export const TABS = [
  'today',
  'plan',
  'train',
  'fuel',
  'sleep',
  'home',
  'inbox',
  'chat',
  'settings',
] as const;
export type TabId = (typeof TABS)[number];

/* ---------- Phase 1: calendars and work shifts ---------- */

export type EventKind = 'work' | 'school' | 'family' | 'dashboard';
export type SourceKind = Exclude<EventKind, 'dashboard'>;

/** Timed events use ISO UTC ("2026-11-26T14:00:00Z"); all-day events use a date ("2026-11-26", end exclusive). */
export interface CalEvent {
  id: string;
  sourceId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  kind: EventKind;
}

/** The feed URL is never sent back to the browser: it can contain a secret token. */
export interface CalendarSource {
  id: string;
  name: string;
  kind: SourceKind;
  host: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface ShiftChange {
  id: number;
  sourceName: string;
  type: 'added' | 'removed' | 'changed';
  title: string;
  old: { start: string; end: string } | null;
  new: { start: string; end: string } | null;
  at: string;
}
