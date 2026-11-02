// Puts a backup from scripts/backup.mjs back into an empty project, after the schema is there
// (`supabase db push` to a new project, or `supabase db reset` locally):
//   node scripts/restore.mjs <backup.json>                             into the linked cloud project
//   node scripts/restore.mjs <backup.json> --local                     into the local stack
//   node scripts/restore.mjs <backup.json> --local --database <name>   into that database of the stack
// Accounts go first, then the tables in the order their foreign keys need, with each table's own
// triggers off so nothing is queued or counted twice. A row the migrations seeded gives way to the
// backup's, and one the backup doesn't hold stays. A backup reads one table after another while
// people use the app, so a row can be in it without its parent: that row is skipped, and the run
// says how many per table. A pack made in that time can be in it without its critter: it stays out,
// and the run names it. Photo files aren't in backups, so the restored feeds and profiles forget
// their photo paths. The Vault values (CRON_SECRET, functions_url) and the function secrets are set
// again by hand (docs/setup.md, section 1).
import { readFileSync } from 'node:fs';

import { query } from './backup.mjs';

const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Usage: node scripts/restore.mjs <backup.json> [--local [--database <name>]]');
const local = flags.includes('--local');
const database = flags.includes('--database') ? flags[flags.indexOf('--database') + 1] : undefined;
if (database && !local) throw new Error('--database names a database of the local stack, so it needs --local.');
const localDatabase = `--db-url postgresql://postgres:postgres@127.0.0.1:54322/${database}`;
const where = database ? localDatabase : local ? '--local' : '--linked';
const backup = JSON.parse(readFileSync(file, 'utf8'));
// The most of a table one call carries. The Management API documents no limit on a request, so this
// goes up only after a rehearsal on a spare project.
const CALL_BYTES = 250_000;
// The tables the migrations seed, with their keys.
const SEEDED = new Map([
  ['public.app_config', 'id'],
  ['public.blocked_words', 'word'],
  ['public.shop_items', 'item'],
]);
let calls = 0;
let largest = 0;
const run = (sql) => {
  calls += 1;
  largest = Math.max(largest, Buffer.byteLength(sql));
  return query(sql, where);
};

/** The rows in lists of at most CALL_BYTES of JSON; a row longer than that goes alone. */
function* inCalls(rows) {
  let part = [];
  let bytes = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (part.length > 0 && bytes + size > CALL_BYTES) {
      yield part;
      part = [];
      bytes = 0;
    }
    part.push(row);
    bytes += size;
  }
  if (part.length > 0) yield part;
}

if (Number(run('select count(*) as c from public.profiles')[0].c) > 0) {
  throw new Error('The target already has data; restore only into an empty project.');
}

// Public tables in foreign key order: a table comes after every table it points to.
const qualified = (name) => (name.includes('.') ? name : `public.${name}`);
const edges = run(
  `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
   from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname = 'public'`,
).map((edge) => ({ child: qualified(edge.child), parent: qualified(edge.parent) }));
const pending = Object.keys(backup.tables).filter((table) => table.startsWith('public.'));
const order = ['auth.users', 'auth.identities'];
while (pending.length > 0) {
  const ready = pending.find((table) =>
    edges.every((edge) => edge.child !== table || edge.parent === table || !pending.includes(edge.parent)),
  );
  if (!ready) throw new Error(`Foreign keys go in a circle among: ${pending.join(', ')}`);
  order.push(ready);
  pending.splice(pending.indexOf(ready), 1);
}

const columns = new Map(
  run(
    `select table_schema || '.' || table_name as t,
            string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols,
            bool_or(identity_generation = 'ALWAYS') as identity
     from information_schema.columns
     where table_schema in ('public', 'auth') and is_generated = 'NEVER'
     group by 1`,
  ).map((row) => [row.t, row]),
);

// A pack is made with its critter, and a backup reads critters before packs, so a pack made in
// between is in the file without one, and no day of a pack like that can close. It is newer than the
// backup, so it stays out, and what it holds goes the way of any row without its parent. A pack from
// before the backup can't get here that way and has history to keep, so it stays for the owner.
const critters = new Set((backup.tables['public.critters'] ?? []).map((row) => row.pack_id));
const noCritter = (backup.tables['public.packs'] ?? []).filter((row) => !critters.has(row.id));
const newPacks = noCritter.filter((row) => Date.parse(row.created_at) >= Date.parse(backup.takenAt));
const oldPacks = noCritter.filter((row) => !newPacks.includes(row));
if (newPacks.length > 0) backup.tables['public.packs'] = backup.tables['public.packs'].filter((row) => !newPacks.includes(row));

const leftOut = [];
for (const table of order) {
  const rows = backup.tables[table] ?? [];
  const { cols: allCols, identity } = columns.get(table);
  // A column newer than the backup isn't in its rows: left out here, it takes its default.
  const cols = allCols
    .split(', ')
    .filter((col) => col.replaceAll('"', '') in (rows[0] ?? {}))
    .join(', ');
  const key = SEEDED.get(table);
  const updates = cols.split(', ').filter((col) => col !== key).map((col) => `${col} = excluded.${col}`);
  const onConflict = key ? `(${key}) do update set ${updates.join(', ')}` : 'do nothing';
  // A new account's profile looks its time zone up in pg_timezone_names, the slowest step of a
  // restore, for a row the backup's profiles replace anyway.
  const quiet = table === 'auth.users' ? 'public.profiles' : table.startsWith('public.') ? table : '';
  // New accounts get a profile from a trigger; the backup's profiles replace them.
  if (table === 'public.profiles') run('delete from public.profiles');
  for (const part of inCalls(rows)) {
    // A `$` only ever sits inside a JSON string, where $ means the same to jsonb, so no text in
    // a backup can end the quotes below.
    const data = JSON.stringify(part).replaceAll('$', '\\u0024');
    // One statement (the CLI sends one), so a DO block: all of it happens, or none. Row by row,
    // because an insert of them all would fail on the one without a parent.
    run(`do $restore$
declare
  backup_row jsonb;
begin
${quiet ? `alter table ${quiet} disable trigger user;` : ''}
for backup_row in select jsonb_array_elements($gz$${data}$gz$::jsonb) loop
  begin
    insert into ${table} (${cols}) ${identity ? 'overriding system value' : ''}
    select ${cols} from jsonb_populate_record(null::${table}, backup_row)
    on conflict ${onConflict};
  exception when foreign_key_violation then
    null;
  end;
end loop;
${quiet ? `alter table ${quiet} enable trigger user;` : ''}
end $restore$`);
  }
  if (identity) {
    run(
      `select setval(pg_get_serial_sequence('${table}', c.column_name), greatest((select max(id) from ${table}), 1))
       from information_schema.columns c
       where c.table_schema || '.' || c.table_name = '${table}' and c.identity_generation = 'ALWAYS'`,
    );
  }
  // A DO block has no way to answer, so the rows now in the table tell how many were skipped. Only a
  // seeded table holds any before its own go in.
  const restored = Number(run(`select count(*) as c from ${table}`)[0].c);
  const skipped = SEEDED.has(table) ? 0 : rows.length - restored;
  console.log(`${table}: ${restored}${skipped > 0 ? `, skipped ${skipped}` : ''}`);
  if (skipped > 0) leftOut.push({ table, skipped });
}

run(`do $restore$ begin
alter table public.feeds disable trigger user;
alter table public.profiles disable trigger user;
update public.feeds set photo_path = null where photo_path is not null;
update public.profiles set avatar_path = null where avatar_path is not null;
alter table public.feeds enable trigger user;
alter table public.profiles enable trigger user;
end $restore$`);
console.log(`Restored the backup from ${backup.takenAt} in ${calls} calls, at most ${Math.ceil(largest / 1000)} KB each.`);
if (leftOut.length > 0) {
  const total = leftOut.reduce((sum, { skipped }) => sum + skipped, 0);
  const tables = leftOut.map(({ table, skipped }) => `${table} ${skipped}`).join(', ');
  console.log(`Left out ${total} rows the backup holds without their parent, or holds twice: ${tables}.`);
}
/** Each pack, with the rows of the backup that are its own. */
const listed = (packs) =>
  packs
    .map((pack) => {
      const held = Object.entries(backup.tables).flatMap(([table, rows]) => {
        const count = rows.filter((row) => row.pack_id === pack.id).length;
        return count > 0 ? [`${table} ${count}`] : [];
      });
      return `${pack.id} "${pack.name}" (${held.join(', ') || 'no rows'})`;
    })
    .join(', ');
if (newPacks.length > 0) {
  console.log(`Left out packs made after the backup began, which it holds without a critter, and their rows: ${listed(newPacks)}.`);
}
if (oldPacks.length > 0) {
  console.log(`Kept packs from before the backup that it holds without a critter: ${listed(oldPacks)}. No day of them can close until each has one.`);
}
