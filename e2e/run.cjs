/**
 * End-to-end check over the real running stack. Start the app first (npm run local, with an EMPTY database),
 * then: npm i -D playwright axe-core, and run: node e2e/run.cjs
 * Uses a stand-in Home Assistant on :8123 and your real network for calendar, food and barcode lookups.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'life-e2e-'));
const BASE = 'http://localhost:5173';
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const nyDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const nyWeekday = () =>
  ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(
      new Date(),
    )
  ];
const results = [];
const axeFindings = {};
const consoleErrors = [];
const pass = (n, d = '') => results.push(['PASS', n, d]);
const fail = (n, d) => results.push(['FAIL', n, String(d).replace(/\s+/g, ' ').slice(0, 420)]);
async function step(name, fn) {
  try {
    const d = await fn();
    pass(name, d ?? '');
  } catch (e) {
    fail(name, e.message || e);
  }
}
const ok = (c, m) => {
  if (!c) throw new Error(m);
};

// --- stand-in Home Assistant (there is no real one to test against) ---
const haCalls = [];
const ha = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    haCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/') return res.end('{"message":"API running."}');
    if (req.url === '/api/states')
      return res.end(
        JSON.stringify([
          { entity_id: 'light.lamp', state: 'off', attributes: { friendly_name: 'Desk lamp' } },
          {
            entity_id: 'lock.front_door',
            state: 'locked',
            attributes: { friendly_name: 'Front door' },
          },
        ]),
      );
    res.end('[]');
  });
});

(async () => {
  await new Promise((r) => ha.listen(8123, r));
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/New_York',
    acceptDownloads: true,
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/status of (4|5)\d\d/.test(m.text())) consoleErrors.push(m.text());
  });
  p.on('dialog', (d) => d.accept('Test name'));
  const api = (m, u, data) =>
    p.request
      .fetch(BASE + u, { method: m, data, headers: { 'sec-fetch-site': 'same-origin' } })
      .then(async (r) => ({
        status: r.status(),
        json: await r.json().catch(() => null),
        text: await r.text().catch(() => ''),
      }));

  const hub = () => p.locator('.radial-hub');
  const goto = async (label) => {
    await hub().click();
    await p.waitForTimeout(500);
    for (let i = 0; i < 12; i++) {
      const cur = await p.evaluate(
        () => document.activeElement?.querySelector?.('.radial-label')?.textContent,
      );
      if (cur === label) break;
      await p.keyboard.press('ArrowDown');
      await p.waitForTimeout(150);
    }
    await p.keyboard.press('Enter');
    await p.waitForTimeout(900);
  };
  const scan = async (name) => {
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(async () => {
      const x = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
      return x.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        n: v.nodes.length,
        sample: v.nodes[0].target.join(' ').slice(0, 90),
        help: v.help,
      }));
    });
    axeFindings[name] = r;
  };

  // 1 ---------------------------------------------------------------- onboarding
  await step('Onboarding: six steps, then Today greets by name', async () => {
    await p.goto(BASE + '/');
    await p.waitForTimeout(1200);
    await p.fill('input[placeholder="Your first name"]', 'Sam');
    await p.locator('button[type=submit]').click();
    await p.waitForTimeout(500);
    await p.getByText('Kilograms').click();
    await p.fill('input[placeholder="e.g. 2200"]', '2200');
    await p.locator('button[type=submit]').click();
    await p.waitForTimeout(500);
    await p.getByText('Google', { exact: true }).click();
    await p.getByText('Mine', { exact: true }).click();
    for (let i = 0; i < 3; i++) {
      await p.locator('button[type=submit]').click();
      await p.waitForTimeout(500);
    }
    await p.locator('button[type=submit]').click();
    await p.waitForTimeout(1500);
    ok(
      await p
        .locator('h1')
        .innerText()
        .then((t) => /Sam/.test(t)),
      'no greeting',
    );
    const prof = (await api('GET', '/api/profile')).json;
    ok(prof.exists && prof.profile.completed, 'profile not saved on server');
    ok(
      prof.profile.timezone === 'America/New_York',
      'timezone not captured: ' + prof.profile.timezone,
    );
    ok(
      prof.profile.units === 'kg' &&
        prof.profile.calorieTarget === 2200 &&
        prof.profile.lunchFor === 'me',
      'answers lost',
    );
    return 'profile saved server-side with timezone';
  });
  await scan('Today (empty)');

  // 2 ---------------------------------------------------------------- plan / calendars
  await step(
    'Plan: add a real public calendar; holiday events appear in the week view',
    async () => {
      await goto('Plan');
      await p.getByLabel('Name').fill('US holidays');
      await p.getByText('Family', { exact: true }).last().click();
      await p
        .getByLabel('Calendar link')
        .fill(
          'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics',
        );
      await p.getByRole('button', { name: 'Add calendar' }).click();
      await p.waitForTimeout(6000);
      const seen = await p.getByText(/Thanksgiving|Black Friday/i).count();
      ok(seen > 0, 'no holiday events in this week');
      return `${seen} holiday event(s) visible`;
    },
  );
  await scan('Plan');

  // 3 ---------------------------------------------------------------- train
  await step(
    'Train: log two workouts, rest timer shows, second one is a PR, history lists both',
    async () => {
      await goto('Train');
      const log = async (w, r) => {
        await p.getByRole('button', { name: 'Start empty workout' }).click();
        await p.getByLabel('Add exercise').fill('bench');
        await p
          .getByRole('button', { name: /Bench press/ })
          .first()
          .click();
        await p.waitForTimeout(500);
        await p.getByLabel('Set 1 weight (kg)').fill(w);
        await p.getByLabel('Set 1 reps').fill(r);
        await p.getByLabel('Set 1 done').click();
        await p.waitForTimeout(400);
        ok((await p.getByRole('timer').count()) > 0, 'rest timer missing');
        await p.getByRole('button', { name: 'Finish' }).click();
        await p.waitForTimeout(900);
      };
      await log('60', '5');
      ok((await p.getByText(/New personal record/).count()) === 0, 'first workout wrongly a PR');
      await log('65', '5');
      ok((await p.getByText(/New personal record/).count()) > 0, 'no PR for heavier set');
      const w = (await api('GET', '/api/workouts')).json.workouts;
      ok(w.length === 2 && w[0].sets[0].pr === 'e1rm', 'history wrong');
      return 'PR detected on the second workout';
    },
  );
  await step(
    'Train: suggestion appears for the next bench session (progressive overload)',
    async () => {
      await p.getByRole('button', { name: 'Start empty workout' }).click();
      await p.getByLabel('Add exercise').fill('bench');
      await p
        .getByRole('button', { name: /Bench press/ })
        .first()
        .click();
      await p.waitForTimeout(600);
      const hint = await p.getByText(/Same weight, aim for|add 2.5 kg/).count();
      await p.getByRole('button', { name: 'Discard' }).click();
      ok(hint > 0, 'no suggestion hint');
    },
  );
  await step(
    'Train: "Plan my week" proposes sessions, approving one puts it on the Dashboard calendar',
    async () => {
      await p.getByRole('button', { name: 'Plan my week' }).click();
      await p.waitForTimeout(1500);
      const n = await p.getByRole('button', { name: 'Add to calendar' }).count();
      ok(n > 0, 'no proposals');
      const before = (
        await api(
          'GET',
          `/api/events?from=${encodeURIComponent(new Date(Date.now() - 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z'))}&to=${encodeURIComponent(new Date(Date.now() + 14 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z'))}`,
        )
      ).json.events.filter((e) => e.kind === 'dashboard').length;
      ok(before === 0, 'calendar written before approval');
      await p.getByRole('button', { name: 'Add to calendar' }).first().click();
      await p.waitForTimeout(1000);
      const after = (
        await api(
          'GET',
          `/api/events?from=${encodeURIComponent(new Date(Date.now() - 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z'))}&to=${encodeURIComponent(new Date(Date.now() + 14 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z'))}`,
        )
      ).json.events.filter((e) => e.kind === 'dashboard').length;
      ok(after === 1, 'approved session not on calendar');
      return `${n} suggestions, 1 approved`;
    },
  );
  await scan('Train');

  // 4 ---------------------------------------------------------------- fuel
  await step('Fuel: quick add updates the ring and totals', async () => {
    await api('PUT', '/api/profile', {
      ...(await api('GET', '/api/profile')).json.profile,
      proteinTarget: 150,
      completed: true,
    });
    await goto('Fuel');
    await p.getByLabel('Quick add name').fill('Chicken wrap');
    await p.getByLabel('Quick add calories').fill('550');
    await p.getByLabel('Quick add protein').fill('40');
    await p.getByRole('button', { name: 'Add', exact: true }).click();
    await p.waitForTimeout(900);
    ok((await p.getByText(/550 kcal of 2200/).count()) > 0, 'totals not shown');
    ok((await p.getByText(/110 g to go/).count()) > 0, 'protein remaining wrong');
  });
  await step('Fuel: real food search (Open Food Facts / USDA via the Worker)', async () => {
    await p.getByLabel('Search foods').fill('greek yogurt');
    await p.getByRole('button', { name: 'Search' }).click();
    await p.waitForTimeout(7000);
    const n = await p.getByRole('list', { name: 'Search results' }).locator('li').count();
    const msg = await p.getByRole('alert').count();
    if (n > 0) {
      await p.getByRole('list', { name: 'Search results' }).locator('button').first().click();
      await p.waitForTimeout(800);
      return `${n} results; first added to the log`;
    }
    ok(msg > 0, 'neither results nor a friendly message');
    return 'databases unreachable from this sandbox: graceful message shown';
  });
  await step('Fuel: barcode lookup (real Open Food Facts product)', async () => {
    await p.getByLabel('Barcode number').fill('3017620422003');
    await p.getByRole('button', { name: 'Look up' }).click();
    await p.waitForTimeout(6000);
    const log = (await api('GET', `/api/food/log?date=${nyDate()}`)).json;
    const hit = log.entries.find((e) => e.source === 'barcode');
    return hit
      ? `added "${hit.name}" (${hit.kcal} kcal)`
      : (await p.getByRole('alert').count())
        ? 'not reachable from sandbox: graceful message shown'
        : (() => {
            throw new Error('no result and no message');
          })();
  });
  await step(
    'Fuel: school lunch card, one tap logs it, changing your mind removes it',
    async () => {
      const wd = nyWeekday();
      await api('PUT', '/api/lunch/rules', {
        rules: [{ weekday: wd, name: 'Pizza slice', kcal: 420, protein: 18, carbs: 50, fat: 15 }],
      });
      await p.reload();
      await p.waitForTimeout(1200);
      await goto('Fuel');
      ok((await p.getByText('Pizza slice').count()) > 0, 'lunch card missing');
      await p.getByRole('button', { name: 'Ate it' }).click();
      await p.waitForTimeout(900);
      let log = (await api('GET', `/api/food/log?date=${nyDate()}`)).json;
      ok(
        log.entries.some((e) => e.source === 'lunch' && e.kcal === 420),
        'lunch not logged',
      );
      await p.getByRole('button', { name: 'Change' }).click();
      await p.waitForTimeout(900);
      log = (await api('GET', `/api/food/log?date=${nyDate()}`)).json;
      ok(!log.entries.some((e) => e.source === 'lunch'), 'lunch entry not removed');
    },
  );
  await scan('Fuel');

  // 5 ---------------------------------------------------------------- sleep
  await step(
    "Sleep: add a night, see hours, debt and tonight's bedtime; one-tap too-short night is refused kindly",
    async () => {
      const wake = new Date(Date.now() - 2 * 3600e3);
      const bed = new Date(wake.getTime() - 6.5 * 3600e3);
      ok(
        (
          await api('POST', '/api/sleep', {
            bedAt: bed.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            wakeAt: wake.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          })
        ).status === 201,
        'sleep not saved',
      );
      await goto('Sleep');
      ok((await p.getByText('6h 30m').count()) > 0, 'hours not shown');
      ok(
        (await p.getByText(/short this week/).count()) > 0 ||
          (await p.getByText(/no sleep debt/).count()) > 0,
        'debt line missing',
      );
      ok((await p.getByText(/Be in bed by/).count()) > 0, 'bedtime suggestion missing');
      await p.getByRole('button', { name: /going to bed/ }).click();
      await p.waitForTimeout(500);
      await p.getByRole('button', { name: /I’m awake/ }).click();
      await p.waitForTimeout(800);
      ok((await p.getByRole('alert').count()) > 0, 'no message for impossible sleep');
      await api('POST', '/api/sleep/wake'); // clean any open state
    },
  );
  await scan('Sleep');

  // 6 ---------------------------------------------------------------- inbox
  await step(
    'Inbox: paste a school email, get a category, summary and a proposed event; approve it',
    async () => {
      await goto('Inbox');
      await p.getByLabel('From').fill('office@lincoln.k12.ny.us');
      await p.getByLabel('Subject').fill('Parent-teacher conferences');
      await p
        .getByLabel('Message')
        .fill(
          'Dear parents, conferences are on December 12 at 6:30pm in the gym. Account number 99887766. Please bring the folder.',
        );
      await p.getByRole('button', { name: 'Add to inbox' }).click();
      await p.waitForTimeout(1200);
      ok(
        (await p.getByText(/Filed under school, with 1 suggested event/).count()) > 0,
        'not filed',
      );
      const card = await p
        .getByRole('region', { name: 'Parent-teacher conferences' })
        .innerText()
        .catch(() => '');
      ok(!card.includes('99887766'), 'sensitive number shown');
      await p.getByRole('button', { name: 'Add to calendar' }).first().click();
      await p.waitForTimeout(1000);
      ok((await p.getByText('approved').count()) > 0, 'approval not reflected');
    },
  );
  await scan('Inbox');

  // 7 ---------------------------------------------------------------- chat
  await step('Chat: built-in answers use real data (workout fit, protein)', async () => {
    await goto('Chat');
    await p.getByRole('button', { name: 'Can I fit legs tomorrow?' }).click();
    await p.waitForTimeout(2000);
    const t1 = await p.getByRole('list').last().innerText();
    ok(/window|Probably not|no free window/i.test(t1), 'no scheduling answer: ' + t1.slice(0, 120));
    await p.getByLabel('Message').fill('Am I under on protein today?');
    await p.getByRole('button', { name: 'Send' }).click();
    await p.waitForTimeout(2000);
    const t2 = await p.getByRole('list').last().innerText();
    ok(/g protein/.test(t2) && /150 g/.test(t2), 'no protein answer: ' + t2.slice(-160));
    return 'answers reference real numbers';
  });
  await scan('Chat');

  // 8 ---------------------------------------------------------------- home
  await step(
    'Home: bad address is refused; connect to a stand-in Home Assistant; allowlist, toggle, confirm lock',
    async () => {
      await goto('Home');
      await p.getByLabel('Home Assistant address').fill('https://192.168.1.5:8123');
      await p.getByLabel('Long-lived access token').fill('t'.repeat(40));
      await p.getByRole('button', { name: 'Connect' }).click();
      await p.waitForTimeout(800);
      ok((await p.getByRole('alert').count()) > 0, 'bad address accepted?');
      await p.getByLabel('Home Assistant address').fill('http://localhost:8123');
      await p.getByRole('button', { name: 'Connect' }).click();
      await p.waitForTimeout(1500);
      ok((await p.getByText(/Devices · localhost:8123/).count()) > 0, 'did not connect');
      ok(
        haCalls.some((c) => c.auth === 'Bearer ' + 't'.repeat(40)),
        'token not sent as bearer',
      );
      await p.getByRole('button', { name: 'Add a device' }).click();
      await p.waitForTimeout(800);
      await p.getByRole('button', { name: /Desk lamp/ }).click();
      await p.waitForTimeout(800);
      await p.getByRole('button', { name: 'Add a device' }).click();
      await p.waitForTimeout(800);
      await p.getByRole('button', { name: /Front door/ }).click();
      await p.waitForTimeout(800);
      await p.getByRole('button', { name: 'Toggle' }).first().click();
      await p.waitForTimeout(800);
      ok(
        haCalls.some((c) => c.url === '/api/services/light/toggle'),
        'lamp toggle not sent',
      );
      const before = haCalls.filter((c) => c.url.includes('/lock/')).length;
      await p.getByRole('button', { name: 'Unlock' }).click();
      await p.waitForTimeout(800);
      ok((await p.getByRole('alertdialog').count()) > 0, 'no confirmation for the lock');
      ok(
        haCalls.filter((c) => c.url.includes('/lock/')).length === before,
        'lock acted before confirmation',
      );
      await p.getByRole('button', { name: 'Confirm' }).click();
      await p.waitForTimeout(900);
      ok(
        haCalls.some((c) => c.url === '/api/services/lock/unlock'),
        'confirmed unlock not sent',
      );
      const cfg = (await api('GET', '/api/home/config')).text;
      ok(!cfg.includes('tttttttttt'), 'token leaked by the API');
      return 'allowlist, toggle and confirmed lock all verified at the HA side';
    },
  );
  await scan('Home');

  // 9 ---------------------------------------------------------------- settings
  await step('Settings: change targets, lunch rules, notifications, family link', async () => {
    await goto('You');
    await p.getByLabel('Calorie target (kcal)').fill('2400');
    await p.getByRole('button', { name: 'Save goals' }).click();
    await p.waitForTimeout(900);
    ok((await api('GET', '/api/profile')).json.profile.calorieTarget === 2400, 'target not saved');
    await p.getByLabel('Monday lunch').fill('Tacos');
    await p.getByLabel('Monday calories').fill('480');
    await p.getByRole('button', { name: 'Save lunch rules' }).click();
    await p.waitForTimeout(800);
    ok(
      (await api('GET', '/api/lunch/rules')).json.rules.some((r) => r.name === 'Tacos'),
      'lunch rule not saved',
    );
    await p.getByLabel('ntfy topic').fill('life-e2e-test-topic-9x');
    await p.getByRole('button', { name: 'Save topic' }).click();
    await p.waitForTimeout(800);
    ok((await api('GET', '/api/notify/config')).json.configured, 'notification topic not saved');
    await p.getByRole('button', { name: 'Create link' }).click();
    await p.waitForTimeout(900);
    const link = await p.getByLabel('Your new family link').inputValue();
    ok(/\/family\?t=[\w-]{43}$/.test(link), 'no family link: ' + link);
    globalThis.FAMILY = link;
  });
  await step(
    'Family link: opens read-only with no work events, then stops after revoke',
    async () => {
      const fam = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const fp = await fam.newPage();
      await fp.goto(globalThis.FAMILY);
      await fp.waitForTimeout(1500);
      const body = await fp.locator('body').innerText();
      ok(
        /week/i.test(body) && /Read-only/.test(body),
        'family page not shown: ' + body.slice(0, 100),
      );
      ok(!(await fp.locator('button').count()), 'family page has controls');
      ok(/Thanksgiving|Nothing scheduled/.test(body), 'no events section');
      await p.getByRole('button', { name: 'Revoke all' }).first().click();
      await p.waitForTimeout(900);
      await fp.reload();
      await fp.waitForTimeout(1200);
      ok(/expired/i.test(await fp.locator('body').innerText()), 'revoked link still works');
      await fam.close();
    },
  );
  await step(
    'Data: JSON export has no secrets; encrypted backup restores into the same data',
    async () => {
      const [dl] = await Promise.all([
        p.waitForEvent('download'),
        p.getByRole('button', { name: 'Export JSON' }).click(),
      ]);
      const exp = fs.readFileSync(await dl.path(), 'utf8');
      ok(
        !exp.includes('url_enc') &&
          !exp.includes('tttttttttt') &&
          !exp.includes('life-e2e-test-topic'),
        'secrets in export',
      );
      ok(JSON.parse(exp).tables.workouts.length === 2, 'workouts missing in export');
      const [bk] = await Promise.all([
        p.waitForEvent('download'),
        p.getByRole('button', { name: 'Download encrypted backup' }).click(),
      ]);
      const file = path.join(S, 'backup.enc');
      await bk.saveAs(file);
      const blob = fs.readFileSync(file, 'utf8');
      ok(
        /^v1\./.test(blob) && !blob.includes('Chicken wrap') && !blob.includes('Sam'),
        'backup not encrypted',
      );
      await api('POST', '/api/food/log', {
        date: nyDate(),
        slot: 'snack',
        name: 'Added after backup',
        kcal: 123,
      });
      await p.locator('input[type=file]').setInputFiles(file);
      await p.waitForTimeout(3000);
      const log = (await api('GET', `/api/food/log?date=${nyDate()}`)).json;
      ok(!log.entries.some((e) => e.name === 'Added after backup'), 'restore did not roll back');
      ok(
        log.entries.some((e) => e.name === 'Chicken wrap'),
        'restore lost data',
      );
      return 'export clean; backup encrypted; restore replaced current data';
    },
  );
  await scan('Settings');

  // 10 --------------------------------------------------------------- today with real data
  await step(
    'Today shows live numbers (no sample data) and no leftover placeholder text',
    async () => {
      await p.reload();
      await p.waitForTimeout(2500);
      const t = await p.locator('main').innerText();
      ok(!/sample value|arrives in Phase/i.test(t), 'placeholder text present');
      ok(
        /calories|workouts/i.test(t) && /of 2400 kcal/.test(t),
        'calorie ring text wrong: ' + t.slice(0, 200),
      );
      ok(/2 of 3 this week/.test(t), 'workout count wrong');
      ok(/Bed by/.test(t), 'bedtime missing');
    },
  );
  await scan('Today (with data)');

  // 11 --------------------------------------------------------------- kill switch
  await step(
    'Kill switch: needs REVOKE, then disconnects calendars, notifications and Home Assistant but keeps your data',
    async () => {
      await goto('You');
      ok(
        await p.getByRole('button', { name: 'Revoke all' }).last().isDisabled(),
        'kill switch enabled without typing',
      );
      await p.getByLabel('Type REVOKE to confirm').fill('REVOKE');
      await p.getByRole('button', { name: 'Revoke all' }).last().click();
      await p.waitForTimeout(1200);
      ok((await api('GET', '/api/sources')).json.sources.length === 0, 'calendars still linked');
      ok(!(await api('GET', '/api/home/config')).json.configured, 'HA still linked');
      ok(!(await api('GET', '/api/notify/config')).json.configured, 'notifications still on');
      ok((await api('GET', '/api/workouts')).json.workouts.length === 2, 'user data was deleted');
    },
  );

  // desktop pass --------------------------------------------------------------------
  await step('Desktop layout: Today and Plan render without horizontal scroll', async () => {
    await p.setViewportSize({ width: 1280, height: 800 });
    await p.reload();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(S, 'e2e-desktop-today.png') });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 1280, 'horizontal scroll on desktop: ' + sw);
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await step('Phone layout: no horizontal scroll on any page', async () => {
    const bad = [];
    for (const label of [
      'Today',
      'Plan',
      'Train',
      'Fuel',
      'Sleep',
      'Home',
      'Inbox',
      'Chat',
      'You',
    ]) {
      if (label !== 'Today') await goto(label);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 391) bad.push(`${label}:${sw}`);
      await p.screenshot({ path: path.join(S, `e2e-${label}.png`) });
    }
    ok(!bad.length, 'overflow on ' + bad.join(', '));
  });

  await browser.close();
  ha.close();

  console.log('\n===== RESULTS =====');
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? '  -> ' + d : ''}`);
  const serious = Object.entries(axeFindings).flatMap(([page, v]) =>
    v.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => ({ page, ...x })),
  );
  console.log('\n===== ACCESSIBILITY (axe, WCAG 2 A/AA, serious+critical) =====');
  console.log(
    serious.length
      ? serious
          .map((x) => `${x.page}: [${x.impact}] ${x.id} x${x.n} (${x.sample}) - ${x.help}`)
          .join('\n')
      : 'none',
  );
  const minor = Object.entries(axeFindings).flatMap(([page, v]) =>
    v
      .filter((x) => !['serious', 'critical'].includes(x.impact))
      .map((x) => `${page}: [${x.impact}] ${x.id} x${x.n}`),
  );
  if (minor.length) console.log('minor/moderate:', minor.join(' | '));
  console.log('\n===== CONSOLE ERRORS =====');
  console.log(consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 8).join('\n') : 'none');
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
})();
