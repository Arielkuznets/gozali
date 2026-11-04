-- One address reports at most ten sign-in problems an hour, whatever the caller puts in its own
-- headers; others still get through, and the address itself isn't kept.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Cloudflare's CF-Connecting-IP is the caller's address; X-Forwarded-For is whatever the caller sent.
create function pg_temp.report_from(address text, times integer) returns void language plpgsql as $$
begin
  for n in 1..times loop
    perform set_config(
      'request.headers',
      json_build_object('cf-connecting-ip', address, 'x-forwarded-for', 'forged-' || n || ', ' || address)::text,
      true
    );
    perform public.report_sign_in_problem('apple ERR_REQUEST_UNKNOWN #' || n || ' from ' || address, 'ios', '1.0.0');
  end loop;
end;
$$;

set local role anon;
select pg_temp.report_from('203.0.113.7', 12);
select pg_temp.report_from('198.51.100.4', 2);
reset role;

select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%from 203.0.113.7'),
  10::bigint,
  'one address gets ten reports in, even with a new X-Forwarded-For each time'
);
select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%from 198.51.100.4'),
  2::bigint,
  'and another address still gets through'
);
select ok(
  not exists (
    select 1 from public.sign_in_report_sources
    where source like '%203.0.113.7%' or source = md5('203.0.113.7') or source = md5('198.51.100.4')
  ),
  'neither the address nor its plain hash is kept'
);

-- A try left on the sheet reports the wait and then its answer, so three of them send six reports.
set local role anon;
select set_config('request.headers', json_build_object('cf-connecting-ip', '192.0.2.50')::text, true);
select public.report_sign_in_problem(
  case when n % 2 = 1 then 'apple no code after 15000 ms: No answer yet, app active' else 'apple ERR_REQUEST_CANCELED after 20000 ms' end
    || ' on try ' || (n + 1) / 2,
  'ios',
  '1.0.0'
)
from generate_series(1, 6) n;
select pg_temp.report_from('192.0.2.50', 5);
reset role;
select results_eq(
  $$ select message from public.app_errors where screen = 'sign-in' and message like '% on try %' order by message $$,
  array[
    'apple ERR_REQUEST_CANCELED after 20000 ms on try 1',
    'apple ERR_REQUEST_CANCELED after 20000 ms on try 2',
    'apple ERR_REQUEST_CANCELED after 20000 ms on try 3',
    'apple no code after 15000 ms: No answer yet, app active on try 1',
    'apple no code after 15000 ms: No answer yet, app active on try 2',
    'apple no code after 15000 ms: No answer yet, app active on try 3'
  ],
  'three slow tries from one address keep every wait and every answer'
);
select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%from 192.0.2.50'),
  4::bigint,
  'and the eleventh report from that address is dropped'
);

-- The caller picks the time zone of its request (Prefer: timezone), and a half-hour one starts its
-- hours half an hour apart. The hour of a report is the same in all of them.
set local role anon;
do $$
declare
  zone text;
begin
  foreach zone in array array['UTC', 'Asia/Kolkata', 'America/New_York'] loop
    perform set_config('timezone', zone, true);
    perform pg_temp.report_from('203.0.113.99', 4);
  end loop;
end;
$$;
reset role;
set local timezone to default;
select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%from 203.0.113.99'),
  10::bigint,
  'one address gets ten reports in, whatever time zone each one names'
);

-- Without Cloudflare's header (a local stack) only the app-wide cap applies.
set local role anon;
select set_config('request.headers', '{}', true);
select public.report_sign_in_problem('apple ERR_REQUEST_UNKNOWN #' || n || ' without an address', 'ios', '1.0.0') from generate_series(1, 7) n;
reset role;
select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%without an address'),
  7::bigint,
  'a call with no address is held only to the cap for the whole app'
);

-- The daily cleanup takes hashes older than the hour.
update public.sign_in_report_sources set at = now() - interval '2 hours';
select public.clean_up_old_rows();
select is((select count(*) from public.sign_in_report_sources), 0::bigint, 'the daily cleanup takes old hashes');

select * from finish();
rollback;
