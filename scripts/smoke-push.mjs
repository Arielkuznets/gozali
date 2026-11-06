// Notifications end to end against the local stack, with a stand-in for Expo Push: feeds queue
// merged "friend fed" and "last one" notifications, claim_notifications releases them, the
// send-push code renders the critter's lines, dead tokens and failed batches are handled, the
// function answers so that trouble reaches the owners, and the owner hears about a new sign-up.
// Run with `npx supabase start` up: node scripts/smoke-push.mjs
import { registerHooks } from 'node:module';
import { format } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import { addDays, packDayOf, wallClock } from '../packages/game-engine/src/index.ts';
import { render } from '../supabase/functions/send-push/messages.ts';
import { EXPO_PUSH_URL, RefusedRequest, runFailed, sendAll } from '../supabase/functions/send-push/push.ts';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) throw new Error('Set SUPABASE_SECRET_KEY (see `npx supabase status`).');

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
// The members live where it is day for the next hour. Quiet hours (23:00 to 07:00) hold the
// pushes back to the morning, when a "last one" for a day that ended is no longer sent, so a
// fixed zone failed this run whenever it ran at night there.
const zones = ['Asia/Jerusalem', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/Sao_Paulo', 'America/New_York', 'America/Los_Angeles', 'Pacific/Auckland'];
const daytime = (zone, time) => {
  const { hour } = wallClock(new Date(time), zone);
  return hour >= 8 && hour < 21;
};
const tz = zones.find((zone) => daytime(zone, run) && daytime(zone, run + 3600_000));
if (!tz) throw new Error('No zone in the list has daytime for the next hour.');

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

async function user(name) {
  const created = await admin.auth.admin.createUser({ email: `${name.toLowerCase()}-${run}@gozali.test`, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  await admin.from('profiles').update({ display_name: name, timezone: tz }).eq('id', id);
  await admin.from('push_tokens').insert({ token: `ExponentPushToken[${name}-${run}]`, user_id: id, platform: 'ios' });
  return id;
}

const noa = await user('Noa');
const dan = await user('Dan');
const maya = await user('Maya');
const { data: pack } = await admin
  .from('packs')
  .insert({ name: 'Runners', category: 'running', rest_days_per_week: 0, timezone: tz, invite_code: `R${String(run).slice(-7)}`.replace(/[01IO]/g, '2') })
  .select('id')
  .single();
await admin.from('critters').insert({ pack_id: pack.id, species: 'kit', status: 'active', stage: 'kid', name: 'Pixel' });
// Everyone joined a few days ago: a member counts from feeds for the day they joined or later.
const joinedAt = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
const joined = await admin.from('pack_members').insert([
  { pack_id: pack.id, user_id: noa, role: 'admin', joined_at: joinedAt },
  { pack_id: pack.id, user_id: dan, role: 'member', joined_at: joinedAt },
  { pack_id: pack.id, user_id: maya, role: 'member', joined_at: joinedAt },
]);
if (joined.error) throw joined.error;

const today = packDayOf(new Date(), tz);
// Everyone fed yesterday, so everyone has started; the notifications that causes don't matter here.
await admin.from('feeds').insert([noa, dan, maya].map((id) => ({ pack_id: pack.id, user_id: id, day: addDays(today, -1) })));
await admin.from('notifications').delete().eq('pack_id', pack.id);

for (const member of [dan, maya]) {
  const fed = await admin.from('feeds').insert({ pack_id: pack.id, user_id: member, day: today });
  if (fed.error) throw fed.error;
}

const { data: queued } = await admin.from('notifications').select('user_id, type, payload').eq('pack_id', pack.id);
check(queued.filter((n) => n.type === 'friend_fed').length === 3, 'two feeds make three friend-fed notifications, merged per member');
check(queued.some((n) => n.type === 'last_one' && n.user_id === noa), 'Noa, the only one left, gets "last one"');

// Claim after the 10-minute merge window, still in the members' daytime and on the same day.
const at = new Date(Date.now() + 11 * 60_000);
const { data: claimed, error } = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
if (error) throw error;
const mine = claimed.filter((row) => row.pack_id === pack.id);
check(mine.length === 4, 'all four are due and claimed');

const sentMessages = [];
const result = await sendAll(mine, async (batch) => {
  sentMessages.push(...batch);
  return batch.map((message) =>
    message.to.includes('Maya') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' },
  );
});
const bodyFor = (id, text) => sentMessages.some((m) => m.to.includes(id) && m.body === text);
check(bodyFor('Noa', '2 friends fed Pixel 🍽️'), 'Noa reads "2 friends fed Pixel"');
check(bodyFor('Dan', 'Maya fed Pixel 🍽️'), 'Dan reads "Maya fed Pixel"');
check(bodyFor('Noa', 'One feed away from a perfect day. The suspense! 🎭'), 'the "last one" line is in Kit\'s voice');
check(sentMessages.find((m) => m.body.startsWith('One feed away'))?.data.url === `/pack/${pack.id}/feed`, '"last one" opens the camera');
check(result.sent === 3 && result.deadTokens.length === 1, "Maya's dead token is reported");
await admin.rpc('forget_push_tokens', { dead: result.deadTokens });
const { data: mayaTokens } = await admin.from('push_tokens').select('token').eq('user_id', maya);
check(mayaTokens.length === 0, 'and forgotten');

// A batch the push service rejects goes back to the queue.
await admin.from('notifications').insert(
  [noa, dan].map((id) => ({ user_id: id, pack_id: pack.id, type: 'evolution', payload: { event: 'evolved', to: 'teen' } })),
);
const again = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
let attempts = 0;
const failed = await sendAll(again.data.filter((row) => row.pack_id === pack.id), async () => {
  attempts += 1;
  throw new Error('push service down');
});
await admin.rpc('requeue_notifications', { ids: failed.requeue });
const { data: evolution } = await admin.from('notifications').select('status').eq('pack_id', pack.id).eq('type', 'evolution');
check(evolution.length === 2 && evolution.every((row) => row.status === 'pending'), 'a failed batch is pending again for the next run');
// Sending each one again would only take time from a run that has to put them back before it ends.
check(attempts === 1, 'a push service that is down is asked once, not once per notification');

// A run that lasts through batch after batch of timeouts is cut off by the function's time limit
// before it can put anything back, so the first request that fails ends the sending.
const lots = Array.from({ length: 250 }, (_, n) => ({
  id: `row-${n}`,
  type: 'friend_fed',
  payload: {},
  names: [],
  critter_name: 'Pixel',
  tokens: [`ExponentPushToken[${n}]`],
}));
let downAttempts = 0;
const down = await sendAll(lots, async () => {
  downAttempts += 1;
  throw new Error('push service down');
});
check(downAttempts === 1 && down.requeue.length === lots.length, 'three batches to a service that is down: asked once, and every row goes back');
let midwayAttempts = 0;
const midway = await sendAll(lots, async (batch) => {
  midwayAttempts += 1;
  if (midwayAttempts === 2) throw new Error('push service down');
  return batch.map(() => ({ status: 'ok' }));
});
check(
  midwayAttempts === 2 && midway.sent === 100 && midway.requeue.join() === lots.slice(100).map((row) => row.id).join(),
  'a service that goes down midway keeps what it took, and the rest goes back unsent',
);
let aloneAttempts = 0;
const refusedThenDown = await sendAll(lots.slice(0, 3), async () => {
  aloneAttempts += 1;
  if (aloneAttempts === 1) throw new RefusedRequest('expo push 400');
  throw new Error('push service down');
});
check(aloneAttempts === 2 && refusedThenDown.requeue.length === 3, 'and so does one that goes down while a refused batch goes out one by one');

// A token from another Expo project makes the push service turn down the whole request. The
// notification with it waits alone; the others in its batch still go out.
await admin.from('notifications').insert({ user_id: dan, pack_id: pack.id, type: 'evolution', payload: { event: 'evolved', to: 'teen' } });
const mixed = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
const batchRows = mixed.data.filter((row) => row.pack_id === pack.id);
const refused = await sendAll(batchRows, async (batch) => {
  if (batch.some((message) => message.to.includes('Dan'))) throw new RefusedRequest('expo push 400');
  return batch.map(() => ({ status: 'ok' }));
});
const dans = batchRows.filter((row) => row.user_id === dan).map((row) => row.id);
check(
  batchRows.length > dans.length && refused.sent === batchRows.length - dans.length && refused.requeue.join() === dans.join(),
  'only the notification the push service refuses waits for the next run',
);
await admin.rpc('requeue_notifications', { ids: refused.requeue });

// A run out of time sends nothing more and puts the rest back, before the time limit cuts it off.
const late = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
const lateRows = late.data.filter((row) => row.pack_id === pack.id);
let lateAttempts = 0;
const outOfTime = await sendAll(
  lateRows,
  async (batch) => {
    lateAttempts += 1;
    return batch.map(() => ({ status: 'ok' }));
  },
  () => true,
);
check(
  lateRows.length > 0 && lateAttempts === 0 && outOfTime.sent === 0 && outOfTime.requeue.length === new Set(lateRows.map((row) => row.id)).size,
  'a run out of time puts what is left back instead of sending it',
);
await admin.rpc('requeue_notifications', { ids: outOfTime.requeue });

// A run the push service took nothing from answers with an error, which is what reaches the
// owners. A phone that is gone is an answer from the service, and no phones means nothing to send.
check(down.attempted === 100 && runFailed(down), 'a run the push service took nothing from failed');
check(refusedThenDown.attempted === 3 && runFailed(refusedThenDown), 'and so did one it refused and then went down on');
check(down.failure === 'push service down' && midway.failure === 'push service down', 'a run says what the request that ended it failed with');
check(refusedThenDown.failure === 'push service down', 'rather than a refusal before it');
check(midway.attempted === 200 && !runFailed(midway), 'one it took part of did not');
const noPhones = await sendAll([{ ...lots[0], tokens: [] }], async () => {
  throw new Error('nothing to send');
});
check(noPhones.attempted === 0 && !runFailed(noPhones), 'and neither did one with no phones to send to');
const goneTickets = (batch) => batch.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } }));
const gone = await sendAll(lots.slice(0, 3), async (batch) => goneTickets(batch));
check(gone.attempted === 3 && gone.deadTokens.length === 3 && !runFailed(gone), 'nor one that only found phones that are gone');
let goneRequests = 0;
const goneAlone = await sendAll(lots.slice(0, 3), async (batch) => {
  goneRequests += 1;
  if (goneRequests === 1) throw new RefusedRequest('expo push 400');
  return goneTickets(batch);
});
check(goneAlone.attempted === 3 && goneAlone.deadTokens.length === 3 && !runFailed(goneAlone), 'also when they went out one by one after a refusal');

// An error on a ticket, other than a phone that is gone, is a message that won't arrive. Those are
// counted by Expo's code, and they reach the owners even when the rest of the run went out.
const ticketCodes = ['InvalidCredentials', 'InvalidCredentials', 'MessageRateExceeded', 'DeviceNotRegistered', undefined];
const ticketed = await sendAll(lots.slice(0, 6), async (batch) =>
  batch.map((_, index) => (index < ticketCodes.length ? { status: 'error', details: { error: ticketCodes[index] } } : { status: 'ok' })),
);
check(
  ticketed.sent === 1 && ticketed.deadTokens.length === 1 && JSON.stringify(ticketed.ticketErrors) === '{"InvalidCredentials":2,"MessageRateExceeded":1,"unknown":1}',
  'errors on tickets are counted by their code',
);
check(runFailed(ticketed), 'and a run with any of them failed, even with the rest out');
check(JSON.stringify(gone.ticketErrors) === '{}' && JSON.stringify(midway.ticketErrors) === '{}', 'phones that are gone are not among them');
check(gone.failure === undefined && ticketed.failure === undefined, 'a run whose requests all got an answer names no failure');

// The real function, with Deno and Expo stood in for: `expo` answers each request, `database` may
// answer an RPC instead of the server, and the claim runs at `at` and returns only the given rows.
registerHooks({ resolve: (specifier, context, next) => next(specifier.replace(/^npm:(.+)@\d+$/, '$1'), context) });
const cronSecret = 'smoke-push';
const functionEnv = { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: secretKey, CRON_SECRET: cronSecret };
let sendPush;
globalThis.Deno = { env: { get: (name) => functionEnv[name] }, serve: (handler) => (sendPush = handler) };
const { REQUEST_TIMEOUT_MS, SEND_BUDGET_MS, HEARTBEAT_TIMEOUT_MS } = await import('../supabase/functions/send-push/index.ts');

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
// How the outside check at HEARTBEAT_URL answers a ping.
let heartbeat = () => new Response('OK');
async function runFunction(rowIds, expo, database = () => null) {
  const logged = [];
  const pings = [];
  console.error = (...line) => logged.push(format(...line));
  globalThis.fetch = async (target, init) => {
    if (String(target) === EXPO_PUSH_URL) return expo(JSON.parse(init.body), init);
    if (String(target) === functionEnv.HEARTBEAT_URL) {
      pings.push(init ?? {});
      return heartbeat(init);
    }
    const rpc = /\/rpc\/(\w+)$/.exec(String(target))?.[1];
    const answered = rpc ? database(rpc, JSON.parse(init.body)) : null;
    if (answered) return answered;
    if (rpc !== 'claim_notifications') return realFetch(target, init);
    const claimed = await realFetch(target, { ...init, body: JSON.stringify({ at_time: at.toISOString() }) });
    return Response.json((await claimed.json()).filter((row) => rowIds.includes(row.id)));
  };
  try {
    const answer = await sendPush(new Request('http://send-push', { method: 'POST', headers: { 'x-cron-secret': cronSecret } }));
    return { status: answer.status, report: await answer.json(), logged, pings };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realConsoleError;
  }
}
const expoTakes = (seen = []) => (batch) => {
  seen.push(...batch);
  return Response.json({ data: batch.map(() => ({ status: 'ok' })) });
};
const expoFails = (status = 401) => new Response('{}', { status });
const firstBatchOnly = () => {
  let requests = 0;
  return (batch) => {
    requests += 1;
    return requests === 1 ? expoTakes()(batch) : expoFails();
  };
};
const expoHangs = (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
// Runs `work` with every request to Expo given up on at once, and notes how long it was allowed.
const allowed = [];
const givingUpAtOnce = async (work) => {
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    allowed.push(ms);
    const timeout = new AbortController();
    setTimeout(() => timeout.abort(new Error('timed out')), 1);
    return timeout.signal;
  };
  try {
    return await work();
  } finally {
    AbortSignal.timeout = realTimeout;
  }
};
const databaseFails = (name) => (rpc) => (rpc === name ? Response.json({ code: 'XX000', message: 'database down' }, { status: 500 }) : null);
const addRows = async (rows) => {
  const added = await admin.from('notifications').insert(rows).select('id');
  if (added.error) throw added.error;
  return added.data.map((row) => row.id);
};
const queueRows = async (ids) => (await admin.from('notifications').select('status, attempts, send_after').in('id', ids)).data;
const signUpFor = (id) => ({ user_id: id, type: 'new_user', payload: { name: 'Tal', number: 3 } });
const twoBatches = Array.from({ length: 101 }, () => signUpFor(dan));

// An outage says nothing about the rows it sends back. They spend no try, however long it lasts, and
// go out when it ends, the owners' summary of it with the rest.
const outageRows = await addRows([
  { user_id: noa, type: 'daily_summary', day: today, payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, serverErrors: 600 } },
  { user_id: dan, pack_id: pack.id, type: 'evolution', payload: { event: 'hatched' } },
]);
const outageAnswers = [401, 403, 429, 500, 502, 503, 504, 401, 503];
const outage = [];
for (const status of outageAnswers) {
  await admin.from('notifications').update({ send_after: new Date().toISOString() }).in('id', outageRows);
  outage.push(await runFunction(outageRows, () => expoFails(status)));
}
check(
  outage.every(({ status, report }) => status === 502 && report.attempted === 2 && report.requeued === 2),
  'nine failed runs in a row each find the rows, answer 502 and put them back',
);
// A wrong access token doesn't end by itself, so the owners have to be able to tell it from Expo
// being down: the body is what reaches them, and the log is where they look next.
check(
  outage.every(({ report }, run) => report.failure === `expo push ${outageAnswers[run]}`),
  'and each says what Expo answered, so a wrong access token reads apart from Expo being down',
);
check(
  outage.every(({ logged }, run) => logged.some((line) => line.startsWith('send-push failed') && line.includes(`expo push ${outageAnswers[run]}`))),
  'in the log too',
);
const afterOutage = await queueRows(outageRows);
check(afterOutage.every((row) => row.status === 'pending' && row.attempts === 0), 'and the rows have spent no try');
check(afterOutage.every((row) => new Date(row.send_after) - Date.now() < 90_000), 'and rows this young wait a minute');
const recovery = [];
const recovered = await runFunction(outageRows, expoTakes(recovery));
check(recovered.status === 200 && recovered.report.sent === 2, 'when Expo is back they go out');
check(recovery.some((message) => message.to.includes('Noa') && message.body.includes('600 server errors')), 'and the owner hears about the outage');
check((await queueRows(outageRows)).every((row) => row.status === 'sent'), 'and they leave the queue');

// Expo can take a batch and lose the answer, so a row that goes back may be on the phones already.
// This walks cron's minutes through an incident of that kind, with the row as old as it would be by
// then and each run lasting `runSeconds`, and returns the minutes the row went out on and the row as
// the incident leaves it. Every run claims all that is due, so each incident gets a row of its own.
async function lostAnswers(rowIds, answer, runSeconds, minutes) {
  const copies = [];
  for (let minute = 0; minute < minutes; ) {
    const asOldAsThat = new Date(Date.now() - minute * 60_000).toISOString();
    await admin.from('notifications').update({ created_at: asOldAsThat, send_after: new Date().toISOString() }).in('id', rowIds);
    await runFunction(rowIds, (batch, init) => {
      copies.push(minute);
      return answer(batch, init);
    });
    const [{ send_after: due }] = await queueRows(rowIds);
    minute = Math.ceil(minute + (runSeconds * 1000 + (new Date(due) - Date.now())) / 60_000);
  }
  return { copies, left: await queueRows(rowIds) };
}
const summaryOf = (day) => ({ user_id: noa, type: 'daily_summary', day, payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, serverErrors: 9 } });
const hangs = await givingUpAtOnce(async () => lostAnswers(await addRows(summaryOf(addDays(today, -1))), expoHangs, 20, 360));
const gatewayRow = await addRows(summaryOf(addDays(today, -2)));
const gateway = await lostAnswers(gatewayRow, () => expoFails(502), 1, 360);
const inTwoHours = (copies) => copies.filter((minute) => minute < 120).length;
check(
  [hangs, gateway].every(({ copies }) => inTwoHours(copies) <= 10 && copies.length <= 18),
  'a row whose answers are lost goes out at most 10 times in two hours and 18 in six',
);
check([hangs, gateway].every(({ copies }) => [30, 31].includes(copies.at(-1) - copies.at(-2))), 'and once every half hour after that');
check(
  [hangs, gateway].every(({ left }) => left.every((row) => row.status === 'pending' && row.attempts === 0)),
  'it spends no try, however long that lasts',
);
await admin.from('notifications').update({ send_after: new Date().toISOString() }).in('id', gatewayRow);
const answered = await runFunction(gatewayRow, expoTakes());
check(answered.status === 200 && answered.report.sent === 1, "and goes out once the answers come back, the owners' summary too");
check((await queueRows(gatewayRow)).every((row) => row.status === 'sent'), 'and leaves the queue');

// A refusal is about the row, so it spends a try and waits longer, while the rows beside it in the
// run don't pay for it.
const refusalRows = await addRows([signUpFor(noa), signUpFor(dan)]);
const refusedRun = await runFunction(refusalRows, (batch) =>
  batch.some((message) => message.to.includes('Dan')) ? new Response('{}', { status: 400 }) : expoTakes()(batch),
);
check(refusedRun.report.sent === 1 && refusedRun.report.requeued === 1, 'a refused notification goes back while the rest go out');
const { data: refusedAfter } = await admin.from('notifications').select('attempts').in('id', refusalRows).eq('user_id', dan);
check(refusedAfter[0].attempts === 1, 'and it spends a try');
check(
  refusedRun.status === 502 && JSON.stringify(refusedRun.report.ticketErrors) === '{"RefusedRequest":1}' && refusedRun.report.failure === 'expo push 400',
  'a run with a refusal failed, with the rest out, and says why',
);
check(refusedRun.logged.some((line) => line.startsWith('send-push failed')), 'in the log too');
const loneRow = await addRows(signUpFor(noa));
const loneRefused = await runFunction(loneRow, () => new Response('{}', { status: 400 }));
check(
  loneRefused.status === 502 && JSON.stringify(loneRefused.report.ticketErrors) === '{"RefusedRequest":1}',
  'and so does one that had nothing else to send, so the two read alike',
);
check(JSON.stringify(refused.refused) === JSON.stringify(dans), 'Expo refusing a notification names it as refused');
check([down, midway, refusedThenDown, outOfTime].every((result) => result.refused.length === 0), 'a service that is down or a run out of time names none');
const idsOf = (rows) => rows.map((row) => row.id).join();
check(
  down.unsent.join() === idsOf(lots.slice(100)) && midway.unsent.join() === idsOf(lots.slice(200)),
  'what a run never offered is named unsent, and what was in the request that failed is not',
);
check(outOfTime.unsent.length === outOfTime.requeue.length, 'all a run out of time puts back is unsent');
check(refusedThenDown.unsent.join() === idsOf(lots.slice(1, 3)), 'and so is what Expo got only in a batch it turned down whole');
check(refused.unsent.length === 0, 'but not a row Expo refused alone');
let oneByOne = 0;
const refusedOneThenDown = await sendAll(lots.slice(0, 3), async () => {
  oneByOne += 1;
  if (oneByOne > 2) throw new Error('push service down');
  throw new RefusedRequest('expo push 400');
});
check(
  refusedOneThenDown.requeue.length === 3 && refusedOneThenDown.refused.join() === lots[0].id,
  'only what it refused alone counts, not what it never got to',
);

// A function on a server without the `refused` argument still gets the rows back, at the old price
// of a try each, and answers 502 even if the rest of the run went fine, so that it is seen.
const behindRows = await addRows(twoBatches);
const noArgument = () =>
  Response.json({ code: 'PGRST202', message: 'Could not find the function public.requeue_notifications(ids, refused)' }, { status: 404 });
const behind = await runFunction(behindRows, firstBatchOnly(), (rpc, args) => (rpc === 'requeue_notifications' && args.refused ? noArgument() : null));
check(behind.status === 502 && behind.report.sent === 100 && behind.report.requeued === 1, 'a server without the migration makes the run answer 502');
check(behind.report.requeueError === 'requeue_notifications(ids, refused) is missing on this server', 'and its body names what is missing');
check(behind.logged.some((line) => line.includes('requeue_notifications')), 'and it says so in the log');
const behindAfter = (await queueRows(behindRows)).filter((row) => row.status === 'pending');
check(behindAfter.length === 1 && behindAfter[0].attempts === 1, 'and the rows go back all the same');

// Rows a run never offered to Expo can't be on the phones, so they come back in a minute however
// old they are. Those in the request that failed wait half their age, in case Expo took them.
const neverOfferedRows = await addRows(twoBatches);
await admin.from('notifications').update({ created_at: new Date(Date.now() - 4 * 3600_000).toISOString() }).in('id', neverOfferedRows);
const offered = new Set();
const firstFails = await runFunction(neverOfferedRows, (batch) => {
  for (const message of batch) offered.add(message.data.notificationId);
  return expoFails(503);
});
const minutesLeft = (row) => (new Date(row.send_after) - Date.now()) / 60_000;
const { data: afterFirstFails } = await admin.from('notifications').select('id, attempts, send_after').in('id', neverOfferedRows);
const notOffered = afterFirstFails.filter((row) => !offered.has(row.id));
check(firstFails.status === 502 && offered.size === 100 && notOffered.length === 1, 'a run whose first request fails offers Expo nothing more');
check(notOffered.every((row) => minutesLeft(row) < 1.5), 'and the four-hour-old row it never offered comes back in a minute');
check(
  afterFirstFails.filter((row) => offered.has(row.id)).every((row) => minutesLeft(row) > 29),
  'while those of the failed request wait half an hour',
);
check(afterFirstFails.every((row) => row.attempts === 0), 'and none spends a try');

// A server with the `refused` argument but not `unsent` takes the rows back as it always did, and the
// run answers 502 so that it is seen.
const halfBehindRows = await addRows(twoBatches);
const noUnsent = () =>
  Response.json({ code: 'PGRST202', message: 'Could not find the function public.requeue_notifications(ids, refused, unsent)' }, { status: 404 });
const halfBehind = await runFunction(halfBehindRows, firstBatchOnly(), (rpc, args) => (rpc === 'requeue_notifications' && args.unsent ? noUnsent() : null));
check(halfBehind.status === 502 && halfBehind.report.requeued === 1, 'a server without the unsent list makes the run answer 502');
check(halfBehind.report.requeueError === 'requeue_notifications(ids, refused, unsent) is missing on this server', 'naming that');
const halfBehindAfter = (await queueRows(halfBehindRows)).filter((row) => row.status === 'pending');
check(halfBehindAfter.length === 1 && halfBehindAfter[0].attempts === 0, 'and takes the row back without spending a try');

// The status is what reaches the owners, through collect_service_errors, and the body and the log
// are what they read then.
const forbidden = await sendPush(new Request('http://send-push', { method: 'POST', headers: { 'x-cron-secret': 'wrong' } }));
check(forbidden.status === 403, 'a caller without the secret is turned away');
const noClaim = await runFunction([], () => expoFails(), databaseFails('claim_notifications'));
check(noClaim.status === 500 && noClaim.report.error === 'database down', 'a run that can claim nothing answers 500 and says why');
const idle = await runFunction([], () => expoFails());
check(idle.status === 200 && JSON.stringify(idle.report) === '{"claimed":0,"attempted":0,"sent":0,"requeued":0,"ticketErrors":{}}', 'a run with nothing due answers 200');

const ticketRows = await addRows([signUpFor(noa), signUpFor(dan)]);
const ticketRun = await runFunction(ticketRows, (batch) =>
  Response.json({ data: batch.map((_, index) => (index === 0 ? { status: 'error', details: { error: 'InvalidCredentials' } } : { status: 'ok' })) }),
);
check(
  ticketRun.status === 502 && ticketRun.report.sent === 1 && JSON.stringify(ticketRun.report.ticketErrors) === '{"InvalidCredentials":1}',
  'a run with an error on a ticket answers 502 with the code in its body, even with the rest out',
);
check(ticketRun.logged.some((line) => line.startsWith('send-push failed') && line.includes('InvalidCredentials')), 'and in the log');
const noTickets = await runFunction(await addRows(signUpFor(dan)), () => Response.json({ errors: [{ code: 'INTERNAL_SERVER_ERROR' }] }));
check(noTickets.status === 502 && noTickets.report.failure === 'expo push 200 without tickets', 'an answer with no tickets in it says so');

const strandedRows = await addRows(twoBatches);
const stranded = await runFunction(strandedRows, firstBatchOnly(), databaseFails('requeue_notifications'));
check(stranded.status === 502 && stranded.report.sent === 100 && stranded.report.requeued === 0, "rows that can't go back make a run with deliveries answer 502");
const strandedLog = stranded.logged.find((line) => line.startsWith('requeue failed')) ?? '';
check(strandedLog.includes('database down') && strandedRows.filter((id) => strandedLog.includes(id)).length === 1, 'and the log names them, all that is left of them');
check(stranded.report.requeueError === 'database down', 'and the body says why they couldn\'t go back');

const goneTicket = (batch) => Response.json({ data: batch.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) });
await admin.from('push_tokens').insert({ token: `ExponentPushToken[Maya-again-${run}]`, user_id: maya, platform: 'ios' });
const unforgotten = await runFunction(await addRows(signUpFor(maya)), goneTicket, databaseFails('forget_push_tokens'));
check(unforgotten.status === 200 && unforgotten.logged.some((line) => line.startsWith('forgetting dead tokens failed')), "a dead token that can't be forgotten is logged");
const forgotten = await runFunction(await addRows(signUpFor(maya)), goneTicket);
const { data: mayaAgain } = await admin.from('push_tokens').select('token').eq('user_id', maya);
check(forgotten.status === 200 && mayaAgain.length === 0, 'and one that can be is forgotten');

// A worker may have only 75 seconds left for a run, so it has to stop in time to put rows back.
check(REQUEST_TIMEOUT_MS + SEND_BUDGET_MS <= 75_000, "the last request can't hang past the 75 seconds a run may have");
const realNow = Date.now;
const lateClock = await addRows(twoBatches);
let clockRequests = 0;
const overBudget = await runFunction(lateClock, (batch) => {
  clockRequests += 1;
  Date.now = () => realNow() + SEND_BUDGET_MS + 1;
  return expoTakes()(batch);
});
Date.now = realNow;
check(clockRequests === 1 && overBudget.report.sent === 100 && overBudget.report.requeued === 1, 'a run past its budget starts no other request and puts the rest back');
check((await queueRows(lateClock)).every((row) => row.attempts === 0), 'at no cost to the rows');
const lostRows = await addRows(twoBatches);
const lost = await runFunction(
  lostRows,
  (batch) => {
    Date.now = () => realNow() + SEND_BUDGET_MS + 1;
    return expoTakes()(batch);
  },
  databaseFails('requeue_notifications'),
);
Date.now = realNow;
check(
  lost.status === 502 && lost.report.failure === undefined && lost.report.requeueError === 'database down',
  "a run Expo took all it was offered from, whose rest can't go back, says why it answers 502",
);

const hungRows = await addRows(signUpFor(dan));
const hung = await givingUpAtOnce(() => runFunction(hungRows, expoHangs));
check(
  hung.status === 502 && hung.report.requeued === 1 && allowed.length > 0 && allowed.every((ms) => ms === REQUEST_TIMEOUT_MS),
  'a request that hangs is given up on time, and its rows go back',
);
check(hung.report.failure === 'timed out', 'and the run says the request timed out');

// HEARTBEAT_URL is an outside check that mails the owner when its pings stop. Only a run that went
// well pings it, with nothing in the ping, and the ping can't change how the run answers.
check([idle, hung, forgotten].every((result) => result.pings.length === 0), 'without HEARTBEAT_URL no run pings anything');
functionEnv.HEARTBEAT_URL = 'https://heartbeat.test/ping';
const pinged = await runFunction([], () => expoFails());
check(pinged.status === 200 && pinged.pings.length === 1, 'with it, a run that went well pings the check');
check(!pinged.pings[0].body && (pinged.pings[0].method ?? 'GET') === 'GET', 'with nothing in the ping');
const sentAndPinged = await runFunction(await addRows(signUpFor(dan)), expoTakes());
check(sentAndPinged.status === 200 && sentAndPinged.report.sent === 1 && sentAndPinged.pings.length === 1, 'and so does one that sent something');
const unpinged = [
  await runFunction([], () => expoFails(), databaseFails('claim_notifications')),
  await runFunction(await addRows(signUpFor(dan)), () => expoFails(401)),
  await runFunction(await addRows(signUpFor(dan)), () => new Response('{}', { status: 400 })),
];
check(unpinged.every((result) => result.status !== 200 && result.pings.length === 0), "a run that failed doesn't ping, so the check hears silence");
const pastBudget = await runFunction(await addRows(twoBatches), (batch) => {
  Date.now = () => realNow() + SEND_BUDGET_MS + 1;
  return expoTakes()(batch);
});
Date.now = realNow;
check(pastBudget.status === 200 && pastBudget.pings.length === 0, "nor does one past its budget, which has no time to spare");
heartbeat = () => Promise.reject(new Error('heartbeat down'));
const checkDown = await runFunction([], () => expoFails());
check(checkDown.status === 200 && checkDown.pings.length === 1, 'a check that is down changes nothing about the answer');
heartbeat = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
allowed.length = 0;
const checkHangs = await givingUpAtOnce(() => runFunction([], () => expoFails()));
check(checkHangs.status === 200 && allowed.includes(HEARTBEAT_TIMEOUT_MS), 'nor does one that hangs, which is given up on');
check(HEARTBEAT_TIMEOUT_MS <= 5_000, 'within five seconds');
heartbeat = () => new Response('OK');
delete functionEnv.HEARTBEAT_URL;

// Owner alerts: someone finishing the profile setup tells the owner, in plain words.
const owned = await admin.from('app_owners').insert({ user_id: noa });
if (owned.error) throw owned.error;
const lior = await user('Lior');
await admin.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', lior);
const alerts = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
if (alerts.error) throw alerts.error;
// While Noa is an owner every sign-up on this database tells her, tests running beside this one too.
await admin.from('app_owners').delete().eq('user_id', noa);
const alertMessages = [];
await sendAll(
  alerts.data.filter((row) => row.type === 'new_user' && row.user_id === noa && row.payload.name === 'Lior'),
  async (batch) => {
    alertMessages.push(...batch);
    return batch.map(() => ({ status: 'ok' }));
  },
);
check(alertMessages.length === 1 && /^🐣 Lior joined Gozali, user number \d+$/.test(alertMessages[0].body), 'the owner reads "Lior joined Gozali"');
const summary = render({ type: 'daily_summary', payload: { newUsers: 2, users: 41, feeders: 1, packs: 1, reports: 1, errors: 0 } });
check(summary.body === '👋 2 new (41 in all) · 🍽️ 1 person fed 1 pack · 🚩 1 report', 'the daily summary fits in one line');
const unnamed = render({ type: 'friend_fed', payload: {}, names: [], critter_name: 'Pixel' });
check(unnamed.body === 'Someone fed Pixel 🍽️', 'a friend-fed notice with no feeder left reads "Someone fed Pixel"');
const trouble = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, serverErrors: 3, downHours: 2 } });
check(trouble.body.endsWith('· 🛠️ 3 server errors · 📴 down 2h'), 'and says when the server had trouble');
const files = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, fileMB: 500 } });
check(files.body.endsWith('· 📦 500 MB of files (free plan: 1 GB)'), 'and when the stored files reach half of the plan');
const fewFiles = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, fileMB: 499 } });
check(!fewFiles.body.includes('MB'), 'and says nothing about them below that');
const noBackup = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, backupDays: null } });
check(noBackup.body.endsWith('· 💾 no backup yet'), 'and when no backup has reported');
const oldBackup = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, backupDays: 2 } });
check(oldBackup.body.endsWith('· 💾 last backup 2 days ago'), 'and when a night was missed');
const freshBackup = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, backupDays: 1 } });
check(!freshBackup.body.includes('💾'), 'but not after a good night');
check(!fewFiles.body.includes('💾'), 'nor on a summary queued before backups reported');

await admin.from('packs').delete().eq('id', pack.id);
for (const id of [noa, dan, maya, lior]) await admin.auth.admin.deleteUser(id);
console.log('all good');
process.exit(0);
