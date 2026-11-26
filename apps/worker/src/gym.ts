import { detectPrs, EXERCISE_BY_ID, EXERCISES, suggestNext, type Pr } from '@life/shared';
import { DATE, err, ISO, json, newId, readJson, str, type Handler } from './http';

interface TemplateItem {
  exerciseId: string;
  sets: number;
  reps: number;
}

const clamp = (n: unknown, lo: number, hi: number): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi ? n : null;

export const gym: Handler = async (c) => {
  const { env, path, method, req } = c;

  if (path === '/api/exercises' && method === 'GET') return json({ exercises: EXERCISES });

  if (path === '/api/templates' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, items FROM templates ORDER BY created_at',
    ).all<{ id: string; name: string; items: string }>();
    return json({
      templates: (results ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        items: JSON.parse(t.items) as TemplateItem[],
      })),
    });
  }
  if (path === '/api/templates' && method === 'POST') {
    const b = await readJson(req);
    const name = str(b?.name, 60);
    const items = Array.isArray(b?.items) ? (b!.items as Record<string, unknown>[]) : null;
    if (!name || !items?.length || items.length > 30) return err(400, 'bad_template');
    const clean: TemplateItem[] = [];
    for (const i of items) {
      const sets = clamp(i.sets, 1, 20);
      const reps = clamp(i.reps, 1, 100);
      if (
        typeof i.exerciseId !== 'string' ||
        !EXERCISE_BY_ID.has(i.exerciseId) ||
        sets === null ||
        reps === null
      )
        return err(400, 'bad_template');
      clean.push({ exerciseId: i.exerciseId, sets: Math.round(sets), reps: Math.round(reps) });
    }
    const id = newId();
    await env.DB.prepare('INSERT INTO templates (id, name, items) VALUES (?,?,?)')
      .bind(id, name, JSON.stringify(clean))
      .run();
    return json({ id }, 201);
  }
  const t = /^\/api\/templates\/([0-9a-f-]{36})$/.exec(path);
  if (t && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(t[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/workouts' && method === 'POST') {
    const b = await readJson(req, 200_000);
    const startedAt = typeof b?.startedAt === 'string' ? b.startedAt : '';
    const endedAt = typeof b?.endedAt === 'string' ? b.endedAt : '';
    const sets = Array.isArray(b?.sets) ? (b!.sets as Record<string, unknown>[]) : null;
    if (
      !b ||
      !ISO.test(startedAt) ||
      !ISO.test(endedAt) ||
      !sets ||
      sets.length === 0 ||
      sets.length > 200
    )
      return err(400, 'bad_workout');
    const clean: { exerciseId: string; reps: number; weightKg: number; rpe: number | null }[] = [];
    for (const s of sets) {
      const reps = clamp(s.reps, 1, 100);
      const weightKg = clamp(s.weightKg, 0, 1000);
      if (
        typeof s.exerciseId !== 'string' ||
        !EXERCISE_BY_ID.has(s.exerciseId) ||
        reps === null ||
        weightKg === null
      )
        return err(400, 'bad_set');
      clean.push({
        exerciseId: s.exerciseId,
        reps: Math.round(reps),
        weightKg,
        rpe: clamp(s.rpe, 1, 10),
      });
    }

    // PRs are judged against everything logged before this workout.
    const byExercise = new Map<string, number[]>();
    clean.forEach((s, i) =>
      byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), i]),
    );
    const prBySet = new Map<number, Pr['kind']>();
    const prs: {
      exerciseId: string;
      name: string;
      kind: Pr['kind'];
      value: number;
      weightKg: number;
      reps: number;
    }[] = [];
    for (const [exerciseId, idxs] of byExercise) {
      const hist = await env.DB.prepare(
        'SELECT weight_kg AS weightKg, reps FROM sets WHERE exercise_id = ?',
      )
        .bind(exerciseId)
        .all<{ weightKg: number; reps: number }>();
      const found = detectPrs(
        hist.results ?? [],
        idxs.map((i) => ({ weightKg: clean[i]!.weightKg, reps: clean[i]!.reps })),
      );
      for (const pr of found) {
        const setIdx = idxs[pr.index]!;
        prBySet.set(setIdx, pr.kind);
        prs.push({
          exerciseId,
          name: EXERCISE_BY_ID.get(exerciseId)!.name,
          kind: pr.kind,
          value: pr.value,
          weightKg: clean[setIdx]!.weightKg,
          reps: clean[setIdx]!.reps,
        });
      }
    }

    const id = newId();
    const name = str(b.name, 60) ?? 'Workout';
    const stmts = [
      env.DB.prepare(
        'INSERT INTO workouts (id, name, started_at, ended_at, template_id, notes) VALUES (?,?,?,?,?,?)',
      ).bind(
        id,
        name,
        startedAt,
        endedAt,
        typeof b.templateId === 'string' ? b.templateId.slice(0, 40) : null,
        str(b.notes, 500),
      ),
    ];
    clean.forEach((s, i) =>
      stmts.push(
        env.DB.prepare(
          'INSERT INTO sets (workout_id, exercise_id, idx, reps, weight_kg, rpe, pr) VALUES (?,?,?,?,?,?,?)',
        ).bind(id, s.exerciseId, i, s.reps, s.weightKg, s.rpe, prBySet.get(i) ?? null),
      ),
    );
    await env.DB.batch(stmts);
    return json({ id, prs }, 201);
  }

  if (path === '/api/workouts' && method === 'GET') {
    const limit = Math.min(50, Math.max(1, Number(c.url.searchParams.get('limit')) || 20));
    const { results } = await env.DB.prepare(
      'SELECT id, name, started_at, ended_at FROM workouts ORDER BY started_at DESC LIMIT ?',
    )
      .bind(limit)
      .all<{ id: string; name: string; started_at: string; ended_at: string }>();
    const out = [];
    for (const w of results ?? []) {
      const sets = await env.DB.prepare(
        'SELECT exercise_id AS exerciseId, reps, weight_kg AS weightKg, rpe, pr FROM sets WHERE workout_id = ? ORDER BY idx',
      )
        .bind(w.id)
        .all();
      out.push({
        id: w.id,
        name: w.name,
        startedAt: w.started_at,
        endedAt: w.ended_at,
        sets: sets.results ?? [],
      });
    }
    return json({ workouts: out });
  }
  const del = /^\/api\/workouts\/([0-9a-f-]{36})$/.exec(path);
  if (del && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM workouts WHERE id = ?').bind(del[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/gym/suggest' && method === 'GET') {
    const ex = c.url.searchParams.get('exerciseId') ?? '';
    if (!EXERCISE_BY_ID.has(ex)) return err(400, 'bad_exercise');
    const last = await env.DB.prepare(
      `SELECT s.weight_kg AS weightKg, s.reps FROM sets s JOIN workouts w ON w.id = s.workout_id
       WHERE s.exercise_id = ? AND w.id = (SELECT w2.id FROM workouts w2 JOIN sets s2 ON s2.workout_id = w2.id WHERE s2.exercise_id = ? ORDER BY w2.started_at DESC LIMIT 1)
       ORDER BY s.idx`,
    )
      .bind(ex, ex)
      .all<{ weightKg: number; reps: number }>();
    return json({ last: last.results ?? [], suggestion: suggestNext(last.results ?? []) });
  }

  if (path === '/api/bodyweight' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT date, kg FROM bodyweight ORDER BY date DESC LIMIT 120',
    ).all();
    return json({ entries: results ?? [] });
  }
  if (path === '/api/bodyweight' && method === 'POST') {
    const b = await readJson(req);
    const kg = clamp(b?.kg, 20, 400);
    const date = typeof b?.date === 'string' && DATE.test(b.date) ? b.date : null;
    if (kg === null || !date) return err(400, 'bad_bodyweight');
    await env.DB.prepare(
      'INSERT INTO bodyweight (date, kg) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET kg = excluded.kg',
    )
      .bind(date, kg)
      .run();
    return json({ ok: true }, 201);
  }
  return null;
};
