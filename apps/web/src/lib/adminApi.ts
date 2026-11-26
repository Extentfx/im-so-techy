import { ApiError, call } from './api';

export interface AuditRow {
  id: number;
  at: string;
  source: string;
  action: string;
  target: string | null;
  result: string;
}

export const getAudit = () =>
  call<{ audit: AuditRow[] }>('GET', '/api/audit').then((r) => r.audit ?? []);
export const getNotify = () =>
  call<{ configured: boolean; bedtimeReminder: boolean }>('GET', '/api/notify/config');
export const putNotify = (b: { topic?: string; bedtimeReminder?: boolean }) =>
  call<{ ok: true }>('PUT', '/api/notify/config', b);
export const deleteNotify = () => call<{ ok: true }>('DELETE', '/api/notify/config');
export const testNotify = () => call<{ ok: true }>('POST', '/api/notify/test');
export const createFamilyLink = (days: number) =>
  call<{ token: string; expiresAt: string }>('POST', '/api/family/link', { days });
export const getFamilyLinks = () =>
  call<{ links: string[] }>('GET', '/api/family/links').then((r) => r.links ?? []);
export const revokeFamilyLinks = () => call<{ ok: true }>('DELETE', '/api/family/links');
export const killSwitch = () =>
  call<{ ok: true; revoked: { calendars: number } }>('POST', '/api/admin/kill', {
    confirm: 'REVOKE',
  });
export const restoreBackup = (blob: string) =>
  call<{ restored: Record<string, number> }>('POST', '/api/admin/restore', {
    blob,
    confirm: 'RESTORE',
  });

export interface FamilyView {
  name: string;
  timezone: string;
  expiresAt: string;
  events: {
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    kind: 'school' | 'family';
  }[];
}
export const getFamilyView = async (token: string): Promise<FamilyView> => {
  const res = await fetch(`/api/family/view?t=${encodeURIComponent(token)}`, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new ApiError(res.status, 'not_found');
  return (await res.json()) as FamilyView;
};

/** Save a file the server sends (backup or export) without leaving the page. */
export async function download(
  method: 'GET' | 'POST',
  path: string,
  fallbackName: string,
): Promise<void> {
  const res = await fetch(path, { method, credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'download_failed');
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
