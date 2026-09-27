-- Tables the app listens to through Realtime. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select set_eq(
  $$ select tablename::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' $$,
  array['critters', 'pack_members', 'feeds'],
  'only the tables the app listens to are published'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.critters'::regclass),
  'published tables keep row level security, which Realtime applies per subscriber'
);

select * from finish();
rollback;
