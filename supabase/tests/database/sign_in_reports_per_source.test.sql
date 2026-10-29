-- One address reports at most five sign-in problems an hour; others still get through.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

create function pg_temp.report_from(address text, times integer) returns void language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', address || ', 10.0.0.1')::text, true);
  for n in 1..times loop
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
  'one address gets five reports in'
);
select is(
  (select count(*) from public.app_errors where screen = 'sign-in' and message like '%from 198.51.100.4'),
  2::bigint,
  'and another address still gets through'
);
select ok(
  not exists (select 1 from public.sign_in_report_sources where source like '%203.0.113.7%'),
  'the address itself isn''t kept'
);

select * from finish();
rollback;
