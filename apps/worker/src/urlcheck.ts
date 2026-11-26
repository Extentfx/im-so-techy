/**
 * Validate a user-supplied calendar feed URL before the Worker fetches it.
 * Only public https hosts are allowed (webcal:// is treated as https://).
 */
export function normalizeFeedUrl(input: string): URL | null {
  let raw = input.trim();
  if (raw.length > 2000) return null;
  if (/^webcals?:\/\//i.test(raw)) raw = raw.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return isPublicHost(u.hostname) ? u : null;
}

export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.')) return false; // localhost, single-label intranet names
  if (
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.localhost') ||
    h.endsWith('.lan')
  )
    return false;
  if (h.startsWith('[') || h.includes(':')) return false; // IPv6 literals
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false; // bare IPv4 literals
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return false; // numeric host tricks
  return true;
}

/** Non-GET requests must come from our own pages (the Access cookie is sent automatically). */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * Home Assistant address. Normally it must be a public https URL (a Cloudflare Tunnel or Tailscale
 * Funnel address). During local development (`allowPrivate`) plain http on your own network is allowed.
 */
export function normalizeHaUrl(input: string, allowPrivate: boolean): URL | null {
  const raw = input.trim();
  if (raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || !/^https?:$/.test(u.protocol)) return null;
  if (allowPrivate) return u;
  return u.protocol === 'https:' && isPublicHost(u.hostname) ? u : null;
}
