-- A call from the database to a function waits for the function's own answer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select vault.create_secret('http://functions.test', 'functions_url');
select vault.create_secret('test-secret', 'cron_secret');

-- Nothing here leaves the transaction: the queue is read before anything sends it.
select public.call_edge_function('close-days');
select public.call_edge_function('send-push');

-- close-days starts packs for 90 seconds and cleans up after that, and send-push can take over a
-- minute. Giving up sooner would count a run that went well as a failure in the owners' summary.
select is(
  (select timeout_milliseconds from net.http_request_queue where url = 'http://functions.test/close-days'),
  150000,
  'close-days gets as long as a function can run'
);
select is(
  (select timeout_milliseconds from net.http_request_queue where url = 'http://functions.test/send-push'),
  150000,
  'and so does send-push'
);

select * from finish();
rollback;
