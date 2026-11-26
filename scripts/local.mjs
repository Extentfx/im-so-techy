#!/usr/bin/env node
/**
 * One-command local run: `npm run local`
 *  - creates apps/worker/.dev.vars on first run (local owner, fresh random encryption key)
 *  - applies D1 migrations to a local SQLite database (apps/worker/.wrangler, gitignored)
 *  - starts the Worker (8787) and the web app (5173), refreshing calendar feeds every 15 minutes
 * Open http://localhost:5173
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = join(root, 'apps/worker');
const devVars = join(worker, '.dev.vars');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (!existsSync(devVars)) {
  writeFileSync(
    devVars,
    [
      '# Local development only. Never commit or deploy this file.',
      'LOCAL_DEV=1',
      `TOKEN_KEY=${randomBytes(32).toString('base64')}`,
      'ACCESS_TEAM_DOMAIN=',
      'ACCESS_AUD=',
      'ALLOWED_EMAIL=',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log('Created apps/worker/.dev.vars with a fresh local encryption key.');
}

console.log('Preparing the local database…');
const mig = spawnSync(npx, ['wrangler', 'd1', 'migrations', 'apply', 'life-db', '--local'], {
  cwd: worker,
  stdio: 'inherit',
  input: 'y\n',
});
if (mig.status !== 0) {
  console.error('Could not prepare the local database.');
  process.exit(1);
}

const children = [
  spawn(npx, ['wrangler', 'dev', '--local', '--port', '8787', '--test-scheduled'], {
    cwd: worker,
    stdio: 'inherit',
  }),
  spawn(npx, ['vite', '--port', '5173', '--strictPort'], {
    cwd: join(root, 'apps/web'),
    stdio: 'inherit',
  }),
];

const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', () => (stop(), process.exit(0)));
process.on('SIGTERM', () => (stop(), process.exit(0)));
children.forEach((c) =>
  c.on(
    'exit',
    (code) =>
      code && (console.error('A process stopped; shutting down.'), stop(), process.exit(code)),
  ),
);

// Calendar refresh every 15 minutes, like the production cron.
setInterval(
  () => fetch('http://localhost:8787/cdn-cgi/handler/scheduled').catch(() => undefined),
  15 * 60_000,
);

setTimeout(
  () => console.log('\n  Life Dashboard is running →  http://localhost:5173\n  (Ctrl+C to stop)\n'),
  6000,
);
