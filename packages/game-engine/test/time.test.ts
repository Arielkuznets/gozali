import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  closableDays,
  closesAt,
  dayEnd,
  feedDay,
  minuteOfPackDay,
  monthOf,
  packDayOf,
  weekStartOf,
} from '../src/index.ts';

const JERUSALEM = 'Asia/Jerusalem';
const NEW_YORK = 'America/New_York';
const ATHENS = 'Europe/Athens';
const HOUR = 3_600_000;

describe('pack days', () => {
  it('counts the hours after midnight toward the previous day', () => {
    // 00:30 in Jerusalem (UTC+3 in September) still belongs to the 26th.
    assert.equal(packDayOf(new Date('2026-09-26T21:30:00Z'), JERUSALEM), '2026-09-26');
    // 03:30 belongs to the new day.
    assert.equal(packDayOf(new Date('2026-09-27T00:30:00Z'), JERUSALEM), '2026-09-27');
  });

  it('measures minutes from the 03:00 start of the day', () => {
    assert.equal(minuteOfPackDay(new Date('2026-09-27T00:30:00Z'), JERUSALEM), 30);
    assert.equal(minuteOfPackDay(new Date('2026-09-26T21:30:00Z'), JERUSALEM), 21 * 60 + 30);
  });

  it('ends a day at 03:00 local time and closes it an hour later', () => {
    assert.equal(dayEnd('2026-09-26', JERUSALEM).toISOString(), '2026-09-27T00:00:00.000Z');
    assert.equal(closesAt('2026-09-26', JERUSALEM).toISOString(), '2026-09-27T01:00:00.000Z');
  });

  it('gives days with a DST change 23 or 25 hours', () => {
    const length = (day: string, zone: string) =>
      (dayEnd(day, zone).getTime() - dayEnd(addDays(day, -1), zone).getTime()) / HOUR;
    assert.equal(length('2026-03-26', JERUSALEM), 23);
    assert.equal(length('2026-10-24', JERUSALEM), 25);
    assert.equal(length('2026-03-07', NEW_YORK), 23);
    assert.equal(length('2026-09-26', JERUSALEM), 24);
  });

  it('ends a day at the first 03:00 when the clocks go back over it', () => {
    // In Athens the clocks go back from 04:00 to 03:00 on 2026-10-25, so 03:00 happens twice.
    assert.equal(dayEnd('2026-10-24', ATHENS).toISOString(), '2026-10-25T00:00:00.000Z');
    assert.equal(packDayOf(new Date('2026-10-24T23:59:59Z'), ATHENS), '2026-10-24');
    assert.equal(packDayOf(new Date('2026-10-25T00:00:00Z'), ATHENS), '2026-10-25');
  });

  it('agrees with packDayOf on every day end, DST changes included', () => {
    for (const zone of [JERUSALEM, NEW_YORK, ATHENS, 'Australia/Lord_Howe', 'America/Santiago']) {
      for (let day = '2026-01-01'; day < '2027-01-01'; day = addDays(day, 1)) {
        const end = dayEnd(day, zone).getTime();
        assert.equal(packDayOf(new Date(end - 1), zone), day, `${zone} ${day} before the end`);
        assert.equal(packDayOf(new Date(end), zone), addDays(day, 1), `${zone} ${day} at the end`);
      }
    }
  });
});

describe('closableDays', () => {
  it('lists every open day whose grace window is over, oldest first', () => {
    const now = new Date('2026-09-27T00:30:00Z');
    assert.deepEqual(closableDays('2026-09-24', now, JERUSALEM), ['2026-09-24', '2026-09-25']);
  });

  it('returns nothing before the grace window of the first open day ends', () => {
    assert.deepEqual(closableDays('2026-09-26', new Date('2026-09-27T00:59:00Z'), JERUSALEM), []);
    assert.deepEqual(closableDays('2026-09-26', new Date('2026-09-27T01:00:00Z'), JERUSALEM), ['2026-09-26']);
  });
});

describe('feedDay', () => {
  const capturedBeforeEnd = new Date('2026-09-26T23:50:00Z'); // 02:50 local, still the 26th

  it('uses the server time when the feed was not captured offline', () => {
    assert.equal(feedDay(new Date('2026-09-27T00:40:00Z'), null, JERUSALEM), '2026-09-27');
  });

  it('keeps an offline feed on the day it was captured when it arrives within the grace window', () => {
    assert.equal(feedDay(new Date('2026-09-27T00:40:00Z'), capturedBeforeEnd, JERUSALEM), '2026-09-26');
  });

  it('moves an offline feed to the day it arrived once the grace window is over', () => {
    assert.equal(feedDay(new Date('2026-09-27T01:10:00Z'), capturedBeforeEnd, JERUSALEM), '2026-09-27');
  });

  it('ignores a capture time later than the arrival', () => {
    assert.equal(
      feedDay(new Date('2026-09-26T20:00:00Z'), new Date('2026-09-26T22:00:00Z'), JERUSALEM),
      '2026-09-26',
    );
  });
});

describe('calendar helpers', () => {
  it('finds the start of the week for Sunday and Monday weeks', () => {
    // 2026-09-26 is a Saturday.
    assert.equal(weekStartOf('2026-09-26', 'sunday'), '2026-09-20');
    assert.equal(weekStartOf('2026-09-26', 'monday'), '2026-09-21');
    assert.equal(weekStartOf('2026-09-20', 'sunday'), '2026-09-20');
  });

  it('adds days across month ends and reads the month', () => {
    assert.equal(addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(monthOf('2026-09-26'), '2026-09');
  });
});
