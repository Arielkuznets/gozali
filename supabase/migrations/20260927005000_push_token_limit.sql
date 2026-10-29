-- Push tokens come from register_push_token only, at most ten per member (2026-10-29). The table's
-- own policy let a member write any number of rows with any text as the token, and send-push sends
-- each of a member's notifications to all of their tokens: thousands of made-up ones on one account
-- turned every notification to it into thousands of messages, enough to run the function out of
-- time after the run's other notifications were already marked sent. Members still read and delete
-- their own rows (signing out removes the phone's token), and keep their ten newest phones.
drop policy "push_tokens: manage own" on public.push_tokens;
create policy "push_tokens: read own" on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push_tokens: delete own" on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

create function public.keep_recent_push_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_tokens t
  where t.user_id = new.user_id
    and t.token not in (
      select r.token from public.push_tokens r
      where r.user_id = new.user_id
      order by r.updated_at desc, r.token
      limit 10
    );
  return null;
end;
$$;
revoke execute on function public.keep_recent_push_tokens() from public, anon, authenticated;

create trigger keep_recent_push_tokens after insert or update of user_id, updated_at on public.push_tokens
  for each row execute function public.keep_recent_push_tokens();

-- Accounts with more already keep their ten newest.
delete from public.push_tokens t
where t.token not in (
  select r.token from (
    select token, row_number() over (partition by user_id order by updated_at desc, token) as place
    from public.push_tokens
  ) r
  where r.place <= 10
);
