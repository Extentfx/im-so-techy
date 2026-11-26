import { describe, expect, it } from 'vitest';
import { atLocal } from './tz';
import {
  redact,
  categorize,
  cleanSubject,
  draftEvent,
  extractDates,
  parseLlmEmail,
  summarize,
} from './email';

const TZ = 'America/New_York';
const NOW = atLocal('2026-03-02', '09:00', TZ); // Monday

describe('categorize', () => {
  it('sorts school, work, family and bills mail, and falls back to other', () => {
    expect(
      categorize({
        from: 'office@lincoln.k12.ny.us',
        subject: 'Parent-teacher conference',
        body: 'Please sign up for a slot.',
      }),
    ).toBe('school');
    expect(
      categorize({
        from: 'hr@acme.com',
        subject: 'New shift schedule posted',
        body: 'Your roster for next week is attached.',
      }),
    ).toBe('work');
    expect(
      categorize({
        from: 'mum@home.com',
        subject: "Grandma's birthday dinner",
        body: 'Family party at 6.',
      }),
    ).toBe('family');
    expect(
      categorize({
        from: 'billing@power.co',
        subject: 'Invoice 4411',
        body: 'Amount due: $82.10. Payment due Mar 15.',
      }),
    ).toBe('bills');
    expect(categorize({ from: 'x@y.com', subject: 'Hello', body: 'Just saying hi.' })).toBe(
      'other',
    );
  });
});

describe('summarize', () => {
  it('keeps the first sentences and drops links, quotes and signatures', () => {
    const body =
      'Hi all, the field trip is on Friday. Bring a packed lunch. See https://example.com/form for details.\n> old quoted text\n-- \nMs Rivera\nSent from my phone';
    const s = summarize(body);
    expect(s).toBe('Hi all, the field trip is on Friday. Bring a packed lunch. See for details.');
    expect(s).not.toContain('Rivera');
    expect(summarize('x'.repeat(1000)).length).toBe(220);
    expect(summarize('')).toBe('');
  });
});

describe('redact', () => {
  it('hides numbers, emails and long codes but keeps normal text and short numbers', () => {
    expect(
      redact(
        'Account 123456789 for me@x.com code A1B2C3D4E5F6G7H8I9 on March 12 at 6:30pm, room 204',
      ),
    ).toBe('Account [number] for [email] code [code] on March 12 at 6:30pm, room 204');
    expect(redact('Card 4111 1111 1111 1111')).toBe('Card [number]');
  });
});

describe('extractDates', () => {
  const f = (t: string) =>
    extractDates(t, NOW, TZ).map((d) => `${d.dateKey}${d.time ? ' ' + d.time : ''}`);
  it('reads month-day dates with times, ordinal suffixes and either order', () => {
    expect(f('Parent-teacher night is March 12 at 6:30pm.')).toEqual(['2026-03-12 18:30']);
    expect(f('Concert on the 5th of April, 7 pm')).toEqual(['2026-04-05 19:00']);
    expect(f('Mar 20th, 2026 at noon')).toEqual(['2026-03-20 12:00']);
  });
  it('reads ISO and US numeric dates', () => {
    expect(f('Due 2026-03-30.')).toEqual(['2026-03-30']);
    expect(f('Pay by 3/15 or 4/1/26')).toEqual(['2026-03-15', '2026-04-01']);
  });
  it('resolves tomorrow and weekday names from now', () => {
    expect(f('See you tomorrow at 3pm')).toEqual(['2026-03-03 15:00']);
    expect(f('Meeting on Friday')).toEqual(['2026-03-06']);
    expect(f('Next Monday we start')).toEqual(['2026-03-09']);
  });
  it('rolls an already-passed month-day to next year, and ignores past full dates and impossible ones', () => {
    expect(f('Back on January 10')).toEqual(['2027-01-10']);
    expect(f('It happened 2025-01-10')).toEqual([]);
    expect(f('Feb 30 and 13/45')).toEqual([]);
  });
  it('de-duplicates and caps the number of results', () => {
    expect(f('March 12 at 6pm. Remember March 12 at 6pm!')).toEqual(['2026-03-12 18:00']);
    expect(
      extractDates(Array.from({ length: 12 }, (_, i) => `April ${i + 1}`).join('. '), NOW, TZ),
    ).toHaveLength(5);
  });
});

describe('drafting and validation', () => {
  it('drafts timed events (1 hour, in the local zone) and all-day events', () => {
    const t = draftEvent(
      'Re: Fwd: Concert',
      { dateKey: '2026-04-05', time: '19:00', context: '' },
      TZ,
    );
    expect(t).toMatchObject({
      title: 'Concert',
      start: '2026-04-05T23:00:00Z',
      end: '2026-04-06T00:00:00Z',
      allDay: false,
    });
    expect(
      draftEvent('Trip', { dateKey: '2026-03-12', time: null, context: '' }, TZ),
    ).toMatchObject({ allDay: true, start: '2026-03-12', end: '2026-03-13' });
    expect(cleanSubject('   ')).toBe('Event from email');
  });
  it('accepts only well-formed model output and strips links', () => {
    expect(
      parseLlmEmail({ category: 'school', summary: 'Trip on Friday https://evil.example/x' }),
    ).toEqual({ category: 'school', summary: 'Trip on Friday' });
    expect(parseLlmEmail({ category: 'delete_everything', summary: 'x' })).toBeNull();
    expect(parseLlmEmail({ category: 'work', summary: '' })).toBeNull();
    expect(parseLlmEmail('rm -rf')).toBeNull();
    expect(parseLlmEmail({ category: 'work', summary: 'a'.repeat(900) })!.summary).toHaveLength(
      220,
    );
  });
});
