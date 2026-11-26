import { DEFAULT_PROFILE, sanitizeProfile, type Profile } from '@life/shared';

const KEY = 'life.profile.v1';

export { DEFAULT_PROFILE, sanitizeProfile };

/** Local copy used as a fallback when the server can't be reached. */
export function loadLocalProfile(): Profile {
  try {
    const s = localStorage.getItem(KEY);
    return s ? sanitizeProfile(JSON.parse(s)) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveLocalProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: nothing to do */
  }
}
