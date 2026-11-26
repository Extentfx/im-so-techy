import { loadProfile } from './foundation';
import { DATE, err, json, newId, readJson, str, type Handler } from './http';
import { lookupBarcode, searchFoods } from './foodsearch';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type Slot = (typeof SLOTS)[number];

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
function macros(b: Record<string, unknown> | null): Macros | null {
  const kcal = num(b?.kcal, 0, 5000);
  const protein = num(b?.protein ?? 0, 0, 500);
  const carbs = num(b?.carbs ?? 0, 0, 800);
  const fat = num(b?.fat ?? 0, 0, 500);
  return kcal === null || protein === null || carbs === null || fat === null
    ? null
    : { kcal, protein, carbs, fat };
}

/** 1 = Monday ... 7 = Sunday for a `YYYY-MM-DD` date. */
export const weekdayOf = (date: string): number => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

interface LogRow {
  id: string;
  date: string;
  slot: Slot;
  name: string;
  qty: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  source: string;
}

export async function totalsFor(env: import('./env').Env, date: string) {
  const { results } = await env.DB.prepare(
    'SELECT id, date, slot, name, qty, kcal, protein, carbs, fat, source FROM food_log WHERE date = ? ORDER BY created_at, rowid',
  )
    .bind(date)
    .all<LogRow>();
  const entries = results ?? [];
  const sum = (k: keyof Macros) => Math.round(entries.reduce((a, e) => a + e[k], 0) * 10) / 10;
  return {
    entries,
    totals: { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') },
  };
}

export const food: Handler = async (c) => {
  const { env, path, method, req } = c;

  if (path === '/api/food/log' && method === 'GET') {
    const date = c.url.searchParams.get('date') ?? '';
    if (!DATE.test(date)) return err(400, 'bad_date');
    const profile = await loadProfile(c);
    return json({
      ...(await totalsFor(env, date)),
      targets: { kcal: profile.calorieTarget, protein: profile.proteinTarget },
    });
  }
  if (path === '/api/food/log' && method === 'POST') {
    const b = await readJson(req);
    const date = typeof b?.date === 'string' && DATE.test(b.date) ? b.date : null;
    const slot = SLOTS.find((s) => s === b?.slot);
    const name = str(b?.name, 120);
    const m = macros(b);
    const qty = b?.qty === undefined ? 1 : num(b.qty, 0.1, 50);
    if (!date || !slot || !name || !m || qty === null) return err(400, 'bad_entry');
    const id = newId();
    const k = (x: number) => Math.round(x * qty * 10) / 10;
    await env.DB.prepare(
      'INSERT INTO food_log (id, date, slot, name, qty, kcal, protein, carbs, fat, source) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        date,
        slot,
        name,
        qty,
        Math.round(m.kcal * qty),
        k(m.protein),
        k(m.carbs),
        k(m.fat),
        str(b?.source, 20) ?? 'manual',
      )
      .run();
    return json({ id }, 201);
  }
  const del = /^\/api\/food\/log\/([0-9a-f-]{36})$/.exec(path);
  if (del && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM food_log WHERE id = ?').bind(del[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/foods' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, brand, serving, kcal, protein, carbs, fat, barcode FROM foods ORDER BY name',
    ).all();
    return json({ foods: results ?? [] });
  }
  if (path === '/api/foods' && method === 'POST') {
    const b = await readJson(req);
    const name = str(b?.name, 120);
    const m = macros(b);
    if (!name || !m) return err(400, 'bad_food');
    const id = newId();
    await env.DB.prepare(
      'INSERT INTO foods (id, name, brand, serving, kcal, protein, carbs, fat, barcode) VALUES (?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        name,
        str(b?.brand, 60),
        str(b?.serving, 60) ?? '1 serving',
        m.kcal,
        m.protein,
        m.carbs,
        m.fat,
        typeof b?.barcode === 'string' && /^\d{8,14}$/.test(b.barcode) ? b.barcode : null,
      )
      .run();
    return json({ id }, 201);
  }
  const fd = /^\/api\/foods\/([0-9a-f-]{36})$/.exec(path);
  if (fd && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM foods WHERE id = ?').bind(fd[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/meals' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, items FROM meals ORDER BY name',
    ).all<{ id: string; name: string; items: string }>();
    return json({
      meals: (results ?? []).map((m) => ({ id: m.id, name: m.name, items: JSON.parse(m.items) })),
    });
  }
  if (path === '/api/meals' && method === 'POST') {
    const b = await readJson(req);
    const name = str(b?.name, 60);
    const items = Array.isArray(b?.items) ? (b!.items as Record<string, unknown>[]) : null;
    if (!name || !items?.length || items.length > 30) return err(400, 'bad_meal');
    const clean = [];
    for (const i of items) {
      const m = macros(i);
      const nm = str(i.name, 120);
      if (!m || !nm) return err(400, 'bad_meal');
      clean.push({ name: nm, ...m, qty: num(i.qty, 0.1, 50) ?? 1 });
    }
    const id = newId();
    await env.DB.prepare('INSERT INTO meals (id, name, items) VALUES (?,?,?)')
      .bind(id, name, JSON.stringify(clean))
      .run();
    return json({ id }, 201);
  }
  const ml = /^\/api\/meals\/([0-9a-f-]{36})\/log$/.exec(path);
  if (ml && method === 'POST') {
    const b = await readJson(req);
    const date = typeof b?.date === 'string' && DATE.test(b.date) ? b.date : null;
    const slot = SLOTS.find((s) => s === b?.slot);
    const meal = await env.DB.prepare('SELECT name, items FROM meals WHERE id = ?')
      .bind(ml[1])
      .first<{ name: string; items: string }>();
    if (!date || !slot) return err(400, 'bad_entry');
    if (!meal) return err(404, 'not_found');
    const items = JSON.parse(meal.items) as (Macros & { name: string; qty: number })[];
    await env.DB.batch(
      items.map((i) =>
        env.DB.prepare(
          'INSERT INTO food_log (id, date, slot, name, qty, kcal, protein, carbs, fat, source) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          newId(),
          date,
          slot,
          i.name,
          i.qty,
          Math.round(i.kcal * i.qty),
          Math.round(i.protein * i.qty * 10) / 10,
          Math.round(i.carbs * i.qty * 10) / 10,
          Math.round(i.fat * i.qty * 10) / 10,
          'meal',
        ),
      ),
    );
    return json({ ok: true, count: items.length }, 201);
  }
  const md = /^\/api\/meals\/([0-9a-f-]{36})$/.exec(path);
  if (md && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM meals WHERE id = ?').bind(md[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/food/search' && method === 'GET') {
    const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (q.length < 2) return err(400, 'query_too_short');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const saved = await env.DB.prepare(
      'SELECT id, name, brand, serving, kcal, protein, carbs, fat FROM foods WHERE name LIKE ? ORDER BY name LIMIT 8',
    )
      .bind(like)
      .all();
    const remote = await searchFoods(c.fetchImpl, q, env.FDC_API_KEY || 'DEMO_KEY');
    return json({ saved: saved.results ?? [], ...remote });
  }
  const bc = /^\/api\/food\/barcode\/(\d{8,14})$/.exec(path);
  if (bc && method === 'GET') {
    const local = await env.DB.prepare(
      'SELECT name, brand, serving, kcal, protein, carbs, fat, barcode FROM foods WHERE barcode = ?',
    )
      .bind(bc[1])
      .first();
    if (local) return json({ food: { ...local, source: 'saved' } });
    const hit = await lookupBarcode(c.fetchImpl, bc[1]!);
    return hit ? json({ food: hit }) : err(404, 'not_found');
  }

  /* ----- school lunch ----- */
  if (path === '/api/lunch/rules' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT weekday, name, kcal, protein, carbs, fat FROM lunch_rules ORDER BY weekday',
    ).all();
    return json({ rules: results ?? [] });
  }
  if (path === '/api/lunch/rules' && method === 'PUT') {
    const b = await readJson(req);
    const rules = Array.isArray(b?.rules) ? (b!.rules as Record<string, unknown>[]) : null;
    if (!rules || rules.length > 7) return err(400, 'bad_rules');
    const stmts = [env.DB.prepare('DELETE FROM lunch_rules')];
    for (const r of rules) {
      const wd = num(r.weekday, 1, 7);
      const nm = str(r.name, 80);
      const m = macros(r);
      if (wd === null || !Number.isInteger(wd) || !nm || !m) return err(400, 'bad_rules');
      stmts.push(
        env.DB.prepare(
          'INSERT INTO lunch_rules (weekday, name, kcal, protein, carbs, fat) VALUES (?,?,?,?,?,?)',
        ).bind(wd, nm, m.kcal, m.protein, m.carbs, m.fat),
      );
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  if (path === '/api/lunch/today' && method === 'GET') {
    const date = c.url.searchParams.get('date') ?? '';
    if (!DATE.test(date)) return err(400, 'bad_date');
    const profile = await loadProfile(c);
    if (profile.lunchFor === 'none') return json({ enabled: false, rule: null, status: null });
    const rule = await env.DB.prepare(
      'SELECT weekday, name, kcal, protein, carbs, fat FROM lunch_rules WHERE weekday = ?',
    )
      .bind(weekdayOf(date))
      .first();
    const st = await env.DB.prepare('SELECT status FROM lunch_status WHERE date = ?')
      .bind(date)
      .first<{ status: string }>();
    return json({
      enabled: true,
      rule: rule ?? null,
      status: st?.status ?? null,
      logsCalories: profile.lunchFor === 'me' || profile.lunchFor === 'both',
    });
  }
  if (path === '/api/lunch/confirm' && method === 'POST') {
    const b = await readJson(req);
    const date = typeof b?.date === 'string' && DATE.test(b.date) ? b.date : null;
    const action =
      b?.action === 'ate' || b?.action === 'skipped' || b?.action === 'other' ? b.action : null;
    if (!date || !action) return err(400, 'bad_request');
    const profile = await loadProfile(c);
    const logs = profile.lunchFor === 'me' || profile.lunchFor === 'both';
    const stmts = [
      env.DB.prepare("DELETE FROM food_log WHERE date = ? AND source = 'lunch'").bind(date), // re-confirming replaces, never duplicates
      env.DB.prepare(
        'INSERT INTO lunch_status (date, status) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET status = excluded.status',
      ).bind(date, action),
    ];
    if (action === 'ate' && logs) {
      const rule = await env.DB.prepare(
        'SELECT name, kcal, protein, carbs, fat FROM lunch_rules WHERE weekday = ?',
      )
        .bind(weekdayOf(date))
        .first<{ name: string } & Macros>();
      if (!rule) return err(404, 'no_rule_for_today');
      stmts.push(
        env.DB.prepare(
          "INSERT INTO food_log (id, date, slot, name, qty, kcal, protein, carbs, fat, source) VALUES (?,?,?,?,?,?,?,?,?,'lunch')",
        ).bind(newId(), date, 'lunch', rule.name, 1, rule.kcal, rule.protein, rule.carbs, rule.fat),
      );
    }
    if (action === 'other' && logs) {
      const m = macros(b);
      const nm = str(b?.name, 80);
      if (!m || !nm) return err(400, 'bad_entry');
      stmts.push(
        env.DB.prepare(
          "INSERT INTO food_log (id, date, slot, name, qty, kcal, protein, carbs, fat, source) VALUES (?,?,?,?,?,?,?,?,?,'lunch')",
        ).bind(newId(), date, 'lunch', nm, 1, m.kcal, m.protein, m.carbs, m.fat),
      );
    }
    await env.DB.batch(stmts);
    return json({ ok: true, status: action });
  }
  return null;
};
