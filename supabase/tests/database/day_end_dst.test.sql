-- The day ends at the first 03:00 when the clocks go back over it, plus the 60-minute grace window.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Athens, 2026-10-25: 04:00 EEST goes back to 03:00 EET, so 03:00 happens at 00:00 and 01:00 UTC.
select is(
  public.day_closes_at('Europe/Athens', '2026-10-24'),
  '2026-10-25 01:00:00+00'::timestamptz,
  'a day in Athens ends at the first 03:00 when the clocks go back'
);
select is(
  public.pack_day('Europe/Athens', public.day_closes_at('Europe/Athens', '2026-10-24') - interval '60 minutes'),
  '2026-10-25'::date,
  'which is when pack_day starts the next day'
);
-- Athens, 2026-03-29: 03:00 EET jumps to 04:00 EEST at 01:00 UTC.
select is(
  public.day_closes_at('Europe/Athens', '2026-03-28'),
  '2026-03-29 02:00:00+00'::timestamptz,
  'when 03:00 is skipped the day ends at the jump'
);
-- Jerusalem, 2026-03-27: 02:00 IST jumps to 03:00 IDT, so 03:00 is 00:00 UTC.
select is(
  public.day_closes_at('Asia/Jerusalem', '2026-03-26'),
  '2026-03-27 01:00:00+00'::timestamptz,
  'a zone that skips 02:00 still ends the day at 03:00'
);
-- Chatham, 2026-09-27: 02:45 jumps to 03:45 at 14:00 UTC, so 03:00 never happens that night.
select is(
  public.day_closes_at('Pacific/Chatham', '2026-09-26'),
  '2026-09-26 15:00:00+00'::timestamptz,
  'when the clocks jump over 03:00 the day ends at the jump'
);
select is(
  (
    select count(*) from pg_timezone_names z
    cross join generate_series('2026-01-01'::date, '2026-12-31'::date, interval '1 day') d
    cross join lateral (select public.day_closes_at(z.name, d::date) - interval '60 minutes' as day_end) e
    where z.name in ('Asia/Jerusalem', 'America/New_York', 'Europe/Athens', 'Pacific/Chatham', 'Australia/Lord_Howe', 'Asia/Kathmandu')
      and (public.pack_day(z.name, e.day_end - interval '1 microsecond') <> d::date or public.pack_day(z.name, e.day_end) <> d::date + 1)
  ),
  0::bigint,
  'every day of 2026 ends where pack_day starts the next one, in zones with odd DST changes'
);
select is(
  public.day_closes_at('Asia/Jerusalem', '2026-07-01'),
  '2026-07-02 01:00:00+00'::timestamptz,
  'an ordinary day ends at 03:00 plus the grace window'
);

select * from finish();
rollback;
