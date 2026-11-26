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

export const TABS = ['today', 'plan', 'train', 'fuel', 'sleep', 'home', 'inbox'] as const;
export type TabId = (typeof TABS)[number];
