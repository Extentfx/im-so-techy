import { describe, expect, it } from 'vitest';
import { parseIcs, parseLine, unescapeText, zonedToUtc } from './ics';

const from = Date.UTC(2026, 0, 1);
const to = Date.UTC(2026, 11, 31);
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

describe('zonedToUtc', () => {
  it('handles standard and daylight time', () => {
    expect(zonedToUtc(2026, 1, 15, 9, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 14));
    expect(zonedToUtc(2026, 7, 15, 9, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 6, 15, 13));
    expect(zonedToUtc(2026, 7, 15, 9, 0, 0, 'Eastern Standard Time')).toBe(
      Date.UTC(2026, 6, 15, 13),
    );
  });
  it('falls back to UTC for unknown zones', () => {
    expect(zonedToUtc(2026, 1, 15, 9, 0, 0, 'Not/AZone')).toBe(Date.UTC(2026, 0, 15, 9));
  });
});

describe('unescapeText', () => {
  it('decodes ICS escapes', () => {
    expect(unescapeText('a\\, b\\; c\\nd \\\\ e')).toBe('a, b; c\nd \\ e');
  });
});

describe('parseLine', () => {
  it('splits params and respects quoted colons', () => {
    expect(parseLine('DTSTART;TZID=America/New_York:20260115T090000')).toEqual({
      name: 'DTSTART',
      params: { TZID: 'America/New_York' },
      value: '20260115T090000',
    });
    expect(parseLine('ATTENDEE;CN="A: B":mailto:a@b.c')?.value).toBe('mailto:a@b.c');
  });
});

describe('parseIcs', () => {
  it('reads UTC, TZID and folded, escaped text', () => {
    const r = parseIcs(
      wrap(
        'BEGIN:VEVENT\r\nUID:a1\r\nDTSTART:20260310T130000Z\r\nDTEND:20260310T210000Z\r\nSUMMARY:Late shift\\, ward\r\n 4\r\nLOCATION:Main St\r\nEND:VEVENT\r\n' +
          'BEGIN:VEVENT\r\nUID:a2\r\nDTSTART;TZID=America/New_York:20260310T090000\r\nDURATION:PT1H30M\r\nSUMMARY:Class\r\nEND:VEVENT',
      ),
      from,
      to,
    );
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({
      key: 'a1',
      title: 'Late shift, ward4',
      start: '2026-03-10T13:00:00Z',
      location: 'Main St',
    });
    expect(r.events[1]).toMatchObject({
      start: '2026-03-10T13:00:00Z',
      end: '2026-03-10T14:30:00Z',
    });
  });

  it('reads all-day events as dates with an exclusive end', () => {
    const r = parseIcs(
      wrap(
        'BEGIN:VEVENT\r\nUID:h\r\nDTSTART;VALUE=DATE:20260704\r\nDTEND;VALUE=DATE:20260706\r\nSUMMARY:Holiday\r\nEND:VEVENT',
      ),
      from,
      to,
    );
    expect(r.events[0]).toMatchObject({ allDay: true, start: '2026-07-04', end: '2026-07-06' });
  });

  it('expands weekly rules, honours COUNT, EXDATE and keeps wall-clock time across DST', () => {
    const r = parseIcs(
      wrap(
        'BEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=America/New_York:20260302T090000\r\nDTEND;TZID=America/New_York:20260302T100000\r\n' +
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r\nEXDATE;TZID=America/New_York:20260304T090000\r\nSUMMARY:Gym class\r\nEND:VEVENT',
      ),
      from,
      to,
    );
    // COUNT=6 yields Mar 2, 4, 9, 11, 16, 18; the excluded Mar 4 still counts toward it
    expect(r.events.map((e) => e.start.slice(0, 10))).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-11',
      '2026-03-16',
      '2026-03-18',
    ]);
    expect(r.events[0]!.start).toBe('2026-03-02T14:00:00Z'); // EST
    expect(r.events[1]!.start).toBe('2026-03-09T13:00:00Z'); // after DST starts on Mar 8: still 9:00 local
  });

  it('replaces an occurrence with a RECURRENCE-ID override and skips cancelled events', () => {
    const r = parseIcs(
      wrap(
        'BEGIN:VEVENT\r\nUID:r\r\nDTSTART:20260302T100000Z\r\nDTEND:20260302T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Standup\r\nEND:VEVENT\r\n' +
          'BEGIN:VEVENT\r\nUID:r\r\nRECURRENCE-ID:20260303T100000Z\r\nDTSTART:20260303T150000Z\r\nDTEND:20260303T160000Z\r\nSUMMARY:Standup (moved)\r\nEND:VEVENT\r\n' +
          'BEGIN:VEVENT\r\nUID:c\r\nDTSTART:20260305T100000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone\r\nEND:VEVENT',
      ),
      from,
      to,
    );
    expect(r.events.map((e) => e.title)).toEqual(['Standup', 'Standup (moved)', 'Standup']);
    expect(r.events[1]!.start).toBe('2026-03-03T15:00:00Z');
  });

  it('warns and keeps only the first occurrence of unsupported rules', () => {
    const r = parseIcs(
      wrap(
        'BEGIN:VEVENT\r\nUID:m\r\nDTSTART:20260302T100000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=2MO\r\nSUMMARY:Board\r\nEND:VEVENT',
      ),
      from,
      to,
    );
    expect(r.events).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Unsupported recurrence/);
  });

  it('ignores events outside the window and survives junk', () => {
    expect(parseIcs('not an ics file', from, to).events).toEqual([]);
    const r = parseIcs(
      wrap('BEGIN:VEVENT\r\nUID:o\r\nDTSTART:20300101T100000Z\r\nSUMMARY:Far\r\nEND:VEVENT'),
      from,
      to,
    );
    expect(r.events).toEqual([]);
  });
});
