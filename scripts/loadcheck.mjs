#!/usr/bin/env node
/**
 * Rough load and cost check against a running local stack (`npm run local`).
 * Measures latency of the endpoints a page load uses, sequentially and with a burst of
 * concurrent requests, then prints what a normal day of use costs in Cloudflare free-tier terms.
 */
const BASE = process.env.BASE ?? 'http://localhost:5173';
const today = new Date().toLocaleDateString('en-CA');
const from = new Date(Date.now() - 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');
const to = new Date(Date.now() + 7 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');

const ENDPOINTS = [
  `/api/profile`,
  `/api/events?from=${from}&to=${to}`,
  `/api/alerts`,
  `/api/food/log?date=${today}`,
  `/api/workouts?limit=20`,
  `/api/sleep`,
  `/api/proposals`,
  `/api/email/summary`,
];
const pct = (a, p) =>
  a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const ms = async (url) => {
  const t = performance.now();
  const r = await fetch(BASE + url);
  await r.arrayBuffer();
  return { ms: performance.now() - t, ok: r.ok };
};

console.log(`Load check against ${BASE}\n`);
let bad = 0;
for (const e of ENDPOINTS) {
  const seq = [];
  for (let i = 0; i < 40; i++) {
    const r = await ms(e);
    if (!r.ok) bad++;
    seq.push(r.ms);
  }
  const burst = await Promise.all(Array.from({ length: 25 }, () => ms(e)));
  bad += burst.filter((b) => !b.ok).length;
  const bm = burst.map((b) => b.ms);
  console.log(
    `${e.split('?')[0].padEnd(20)} sequential p50 ${pct(seq, 50).toFixed(0)}ms p95 ${pct(seq, 95).toFixed(0)}ms | 25 at once p95 ${pct(bm, 95).toFixed(0)}ms`,
  );
}

const perPage = ENDPOINTS.length;
const daily = 60 * perPage; // 60 page loads a day is a heavy personal day
console.log(`
A Today page load makes ${perPage} API calls. 60 page loads a day = ${daily} requests,
plus 96 scheduled runs (every 15 minutes) = about ${daily + 96} Worker requests a day.
Cloudflare free tier: 100,000 requests a day. You would use under 1%.
D1 free tier: 5 million rows read and 100,000 rows written a day. A day of use reads a few thousand rows.
Claude is the only real cost: capped by CHAT_DAILY_CAP_USD (default $1.00/day, so $30/month at the very most);
most months with the small model and caching land at a few dollars.

${bad ? `FAILED: ${bad} request(s) returned an error` : 'All requests succeeded.'}`);
process.exit(bad ? 1 : 0);
