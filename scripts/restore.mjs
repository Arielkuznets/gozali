// Puts a backup from scripts/backup.mjs back into an empty project, after the schema is there
// (`supabase db push` to a new project, or `supabase db reset` locally):
//   node scripts/restore.mjs <backup.json>            into the linked cloud project
//   node scripts/restore.mjs <backup.json> --local    into the local stack
// Accounts go first, then the tables in the order their foreign keys need, with each table's own
// triggers off so nothing is queued or counted twice. Photo files aren't in backups, so the restored
// feeds and profiles forget their photo paths. The Vault values (CRON_SECRET, functions_url) and the
// function secrets are set again by hand (docs/setup.md, section 1).
import { readFileSync } from 'node:fs';

import { query } from './backup.mjs';

const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Usage: node scripts/restore.mjs <backup.json> [--local]');
const where = flags.includes('--local') ? '--local' : '--linked';
const backup = JSON.parse(readFileSync(file, 'utf8'));
const BATCH = 200;
const run = (sql) => query(sql, where);

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

for (const table of order) {
  const rows = backup.tables[table] ?? [];
  const { cols, identity } = columns.get(table);
  const own = table.startsWith('public.');
  // New accounts get a profile from a trigger; the backup's profiles replace them.
  if (table === 'public.profiles') run('delete from public.profiles');
  for (let start = 0; start < rows.length; start += BATCH) {
    const data = JSON.stringify(rows.slice(start, start + BATCH));
    if (data.includes('$gz$') || data.includes('$restore$')) throw new Error(`${table} holds text that ends the SQL quote`);
    // One statement (the CLI sends one), so a DO block: all of it happens, or none.
    run(`do $restore$ begin
${own ? `alter table ${table} disable trigger user;` : ''}
insert into ${table} (${cols}) ${identity ? 'overriding system value' : ''}
select ${cols} from jsonb_populate_recordset(null::${table}, $gz$${data}$gz$::jsonb)
on conflict do nothing;
${own ? `alter table ${table} enable trigger user;` : ''}
end $restore$`);
  }
  if (identity) {
    run(
      `select setval(pg_get_serial_sequence('${table}', c.column_name), greatest((select max(id) from ${table}), 1))
       from information_schema.columns c
       where c.table_schema || '.' || c.table_name = '${table}' and c.identity_generation = 'ALWAYS'`,
    );
  }
  console.log(`${table}: ${rows.length}`);
}

run(`do $restore$ begin
alter table public.feeds disable trigger user;
alter table public.profiles disable trigger user;
update public.feeds set photo_path = null where photo_path is not null;
update public.profiles set avatar_path = null where avatar_path is not null;
alter table public.feeds enable trigger user;
alter table public.profiles enable trigger user;
end $restore$`);
console.log(`Restored the backup from ${backup.takenAt}.`);
