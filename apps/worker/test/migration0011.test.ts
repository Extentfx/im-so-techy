import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '..', 'migrations');
const files = readdirSync(dir).sort();
const apply = (db: DatabaseSync, name: string) => db.exec(readFileSync(join(dir, name), 'utf8'));

describe('migration 0011 on a database that already has data', () => {
  it('keeps every calendar, event and shift alert, and keeps cascades working afterwards', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const f of files.filter((x) => x < '0011')) apply(db, f);

    // data as it would exist for someone who has been using the app
    db.exec(`
      INSERT INTO calendar_sources (id, name, kind, url_enc, host, last_synced_at) VALUES
        ('s1', 'Hospital', 'work', 'v1.enc.one', 'cal.example.com', '2026-03-01T00:00:00Z'),
        ('s2', 'School', 'school', 'v1.enc.two', 'school.example.org', NULL);
      INSERT INTO events (id, source_id, key, title, start, end, all_day, location, kind) VALUES
        ('s1:a', 's1', 'a', 'Day shift', '2026-03-03T13:00:00Z', '2026-03-03T21:00:00Z', 0, 'Ward 4', 'work'),
        ('s1:b', 's1', 'b', 'Night shift', '2026-03-04T23:00:00Z', '2026-03-05T07:00:00Z', 0, NULL, 'work'),
        ('s2:c', 's2', 'c', 'Assembly', '2026-03-10', '2026-03-11', 1, NULL, 'school');
      INSERT INTO shift_changes (source_id, type, title, old_start, old_end, new_start, new_end, acknowledged) VALUES
        ('s1', 'changed', 'Day shift', '2026-03-03T11:00:00Z', '2026-03-03T19:00:00Z', '2026-03-03T13:00:00Z', '2026-03-03T21:00:00Z', 0);
    `);
    const before = {
      sources: db
        .prepare(
          'SELECT id, name, kind, url_enc, host, last_synced_at FROM calendar_sources ORDER BY id',
        )
        .all(),
      events: db.prepare('SELECT * FROM events ORDER BY id').all(),
      alerts: db
        .prepare('SELECT source_id, type, title, new_start, acknowledged FROM shift_changes')
        .all(),
    };

    apply(db, '0011_connections.sql');

    expect(
      db
        .prepare(
          'SELECT id, name, kind, url_enc, host, last_synced_at FROM calendar_sources ORDER BY id',
        )
        .all(),
    ).toEqual(before.sources);
    expect(db.prepare('SELECT * FROM events ORDER BY id').all()).toEqual(before.events);
    expect(
      db.prepare('SELECT source_id, type, title, new_start, acknowledged FROM shift_changes').all(),
    ).toEqual(before.alerts);
    expect(db.prepare("SELECT type FROM calendar_sources WHERE id = 's1'").get()).toEqual({
      type: 'ics',
    }); // existing links stay links

    // the new shape accepts account-based calendars and a missing feed address
    db.prepare(
      "INSERT INTO calendar_sources (id, name, kind, type, host, connection_id, remote_id) VALUES ('g1', 'Google', 'family', 'google', 'google.com', 'c1', 'primary')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO calendar_sources (id, name, kind, type, host) VALUES ('x', 'Bad', 'family', 'carrier-pigeon', 'x')",
        )
        .run(),
    ).toThrow();

    // foreign keys point at the right table and cascades still work
    db.prepare(
      "INSERT INTO events (id, source_id, key, title, start, end, kind) VALUES ('g1:z', 'g1', 'z', 'Dentist', '2026-03-03T14:00:00Z', '2026-03-03T15:00:00Z', 'family')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO events (id, source_id, key, title, start, end, kind) VALUES ('q', 'nope', 'q', 'Orphan', '2026-03-03T14:00:00Z', '2026-03-03T15:00:00Z', 'family')",
        )
        .run(),
    ).toThrow();
    db.prepare("DELETE FROM calendar_sources WHERE id = 's1'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE source_id = 's1'").get()).toEqual({
      n: 0,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM shift_changes WHERE source_id = 's1'").get(),
    ).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE source_id = 's2'").get()).toEqual({
      n: 1,
    }); // others untouched
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get()).toMatchObject({
      sql: expect.stringContaining('REFERENCES "calendar_sources"'),
    });

    // indexes were recreated and AUTOINCREMENT carries on from the old ids
    const idx = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(idx).toEqual(
      expect.arrayContaining(['events_range', 'events_source', 'shift_changes_open']),
    );
    db.prepare(
      "INSERT INTO shift_changes (source_id, type, title) VALUES ('s2', 'added', 'x')",
    ).run();
    expect(db.prepare('SELECT MAX(id) AS m FROM shift_changes').get()).toEqual({ m: 2 });
  });
});
