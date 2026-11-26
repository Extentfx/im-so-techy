import type { CalEvent, CalendarSource, Profile, ShiftChange, SourceKind } from '@life/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const FRIENDLY: Record<string, string> = {
  feed_url_must_be_public_https: 'Use a public https:// (or webcal://) calendar link.',
  name_required: 'Give the calendar a short name.',
  too_many_sources: 'You have reached the limit of 10 calendars.',
  bad_kind: 'Pick work, school or family.',
  cross_origin: 'Request blocked. Reload the page and try again.',
};
export const friendly = (e: unknown): string => {
  if (!(e instanceof ApiError)) return 'Could not reach the server.';
  if (e.status === 401) return 'Please sign in again.';
  if (e.code === 'network' || e.code === 'request_failed' || e.code === 'not_found')
    return 'Could not reach the server.';
  return FRIENDLY[e.code] ?? e.code.replace(/_/g, ' ');
};

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed');
  return data as T;
}

export const getEvents = (from: string, to: string) =>
  call<{ events: CalEvent[] }>(
    'GET',
    `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ).then((r) => r.events);
export const getSources = () =>
  call<{ sources: CalendarSource[] }>('GET', '/api/sources').then((r) => r.sources);
export const addSource = (b: { name: string; kind: SourceKind; url: string }) =>
  call<{ source: CalendarSource; error?: string }>('POST', '/api/sources', b);
export const syncSource = (id: string) =>
  call<{ sync: { events: number; changes: number } }>('POST', `/api/sources/${id}/sync`);
export const removeSource = (id: string) => call<{ ok: true }>('DELETE', `/api/sources/${id}`);
export const getAlerts = () =>
  call<{ alerts: ShiftChange[] }>('GET', '/api/alerts').then((r) => r.alerts);
export const ackAlert = (id: number) => call<{ ok: true }>('POST', `/api/alerts/${id}/ack`);

export const getProfile = () => call<{ profile: Profile; exists: boolean }>('GET', '/api/profile');
export const putProfile = (p: Profile) => call<{ profile: Profile }>('PUT', '/api/profile', p);

export interface Proposal {
  id: string;
  source: 'user' | 'chat' | 'scheduler' | 'email';
  kind: string;
  summary: string;
  payload: { title: string; start: string; end: string; location?: string | null };
  status: string;
  createdAt: string;
}
export const getProposals = () =>
  call<{ proposals: Proposal[] }>('GET', '/api/proposals').then((r) => r.proposals ?? []);
export const createProposal = (b: {
  source?: string;
  kind: 'calendar_event';
  summary: string;
  payload: Proposal['payload'];
}) => call<{ id: string }>('POST', '/api/proposals', b);
export const decideProposal = (id: string, action: 'approve' | 'reject') =>
  call<{ ok: true }>('POST', `/api/proposals/${id}/${action}`);

/* ---------- Phase 2: gym and planning ---------- */
import type { Exercise } from '@life/shared';

export interface TemplateItem {
  exerciseId: string;
  sets: number;
  reps: number;
}
export interface Template {
  id: string;
  name: string;
  items: TemplateItem[];
}
export interface LoggedSet {
  exerciseId: string;
  reps: number;
  weightKg: number;
  rpe?: number | null;
  pr?: string | null;
}
export interface Workout {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  sets: LoggedSet[];
}
export interface PrOut {
  exerciseId: string;
  name: string;
  kind: string;
  value: number;
  weightKg: number;
  reps: number;
}
export interface SlotOut {
  dateKey: string;
  start: string;
  end: string;
  score: number;
  reason: string;
}

export const getExercises = () =>
  call<{ exercises: Exercise[] }>('GET', '/api/exercises').then((r) => r.exercises);
export const getTemplates = () =>
  call<{ templates: Template[] }>('GET', '/api/templates').then((r) => r.templates ?? []);
export const saveTemplate = (b: { name: string; items: TemplateItem[] }) =>
  call<{ id: string }>('POST', '/api/templates', b);
export const deleteTemplate = (id: string) => call<{ ok: true }>('DELETE', `/api/templates/${id}`);
export const getWorkouts = () =>
  call<{ workouts: Workout[] }>('GET', '/api/workouts?limit=20').then((r) => r.workouts ?? []);
export const saveWorkout = (b: {
  name: string;
  startedAt: string;
  endedAt: string;
  templateId?: string;
  sets: LoggedSet[];
}) => call<{ id: string; prs: PrOut[] }>('POST', '/api/workouts', b);
export const deleteWorkout = (id: string) => call<{ ok: true }>('DELETE', `/api/workouts/${id}`);
export const getSuggestion = (exerciseId: string) =>
  call<{
    last: { weightKg: number; reps: number }[];
    suggestion: { weightKg: number; reps: number; reason: string } | null;
  }>('GET', `/api/gym/suggest?exerciseId=${exerciseId}`);
export const getBodyweight = () =>
  call<{ entries: { date: string; kg: number }[] }>('GET', '/api/bodyweight').then(
    (r) => r.entries ?? [],
  );
export const saveBodyweight = (date: string, kg: number) =>
  call<{ ok: true }>('POST', '/api/bodyweight', { date, kg });
export const planWeek = (start?: string) =>
  call<{ created: string[]; sessions: SlotOut[] }>(
    'POST',
    '/api/plan/week',
    start ? { start } : {},
  );
export const getSlots = (date: string) =>
  call<{ slots: SlotOut[]; light: boolean; reason: string | null; blockedByShift: boolean }>(
    'GET',
    `/api/plan/slots?date=${date}`,
  );

/* ---------- Phase 3: food and lunch ---------- */
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
export interface LogEntry extends Macros {
  id: string;
  slot: Slot;
  name: string;
  qty: number;
  source: string;
}
export interface FoodHit extends Macros {
  name: string;
  brand: string | null;
  serving: string;
  barcode?: string | null;
  source?: string;
}
export interface DayLog {
  entries: LogEntry[];
  totals: Macros;
  targets: { kcal: number | null; protein: number | null };
}
export interface LunchToday {
  enabled: boolean;
  rule: (Macros & { name: string; weekday: number }) | null;
  status: 'ate' | 'skipped' | 'other' | null;
  logsCalories?: boolean;
}
export const getDayLog = (date: string) => call<DayLog>('GET', `/api/food/log?date=${date}`);
export const addLog = (
  b: { date: string; slot: Slot; name: string; qty?: number; source?: string } & Macros,
) => call<{ id: string }>('POST', '/api/food/log', b);
export const deleteLog = (id: string) => call<{ ok: true }>('DELETE', `/api/food/log/${id}`);
export const searchFood = (q: string) =>
  call<{ saved: FoodHit[]; results: FoodHit[]; sources: { openfoodfacts: string; usda: string } }>(
    'GET',
    `/api/food/search?q=${encodeURIComponent(q)}`,
  );
export const barcodeLookup = (code: string) =>
  call<{ food: FoodHit }>('GET', `/api/food/barcode/${code}`);
export const saveFood = (b: Macros & { name: string; serving?: string; barcode?: string | null }) =>
  call<{ id: string }>('POST', '/api/foods', b);
export const getMeals = () =>
  call<{ meals: { id: string; name: string; items: unknown[] }[] }>('GET', '/api/meals').then(
    (r) => r.meals ?? [],
  );
export const saveMeal = (name: string, items: (Macros & { name: string; qty: number })[]) =>
  call<{ id: string }>('POST', '/api/meals', { name, items });
export const logMeal = (id: string, date: string, slot: Slot) =>
  call<{ count: number }>('POST', `/api/meals/${id}/log`, { date, slot });
export const getLunch = (date: string) => call<LunchToday>('GET', `/api/lunch/today?date=${date}`);
export const confirmLunch = (
  b: { date: string; action: 'ate' | 'skipped' | 'other'; name?: string } & Partial<Macros>,
) => call<{ ok: true }>('POST', '/api/lunch/confirm', b);
export const getLunchRules = () =>
  call<{ rules: (Macros & { weekday: number; name: string })[] }>('GET', '/api/lunch/rules').then(
    (r) => r.rules ?? [],
  );
export const putLunchRules = (rules: (Macros & { weekday: number; name: string })[]) =>
  call<{ ok: true }>('PUT', '/api/lunch/rules', { rules });

/* ---------- Phase 4: sleep ---------- */
export interface SleepSummary {
  nights: { date: string; minutes: number }[];
  targetHours: number;
  debtHours: number;
  recovery: { light: boolean; reason: string | null };
  open: string | null;
  suggestion: { bedtime: string; wake: string; basedOn: string };
}
export const getSleep = () => call<SleepSummary>('GET', '/api/sleep');
export const sleepBed = () => call<{ ok: true }>('POST', '/api/sleep/bed');
export const sleepWake = () => call<{ minutes: number }>('POST', '/api/sleep/wake');
export const logSleep = (bedAt: string, wakeAt: string) =>
  call<{ date: string }>('POST', '/api/sleep', { bedAt, wakeAt });
export const deleteSleep = (date: string) => call<{ ok: true }>('DELETE', `/api/sleep/${date}`);
