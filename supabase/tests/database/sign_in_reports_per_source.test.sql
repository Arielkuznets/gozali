-- One address reports at most five sign-in problems an hour, whatever the caller puts in its own
-- headers; others still get through, and the address itself isn't kept.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

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
select pg_temp.report_from('203.0.113.7', 8);
select pg_temp.report_from('198.51.100.4', 2);
reset role;

select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%from 203.0.113.7'),
  5::bigint,
  'one address gets five reports in, even with a new X-Forwarded-For each time'
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
