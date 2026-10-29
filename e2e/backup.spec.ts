// The backup script against the local stack: no app, just the file it writes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, removeUsers, type TestUser } from './support';

const root = fileURLToPath(new URL('..', import.meta.url));
let noa: TestUser;
let out: string;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  out = mkdtempSync(join(tmpdir(), 'gozali-backup-'));
});

test.afterEach(async () => {
  await removeUsers(noa);
  rmSync(out, { recursive: true, force: true });
});

function run(command: string) {
  const result = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8' });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

test('a backup keeps every row of a table longer than one page', async () => {
  test.setTimeout(180_000);
  const packs = [
    await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }),
    await createPack(noa, { name: 'Morning runs', habit: 'running', species: 'hoot' }),
    await createPack(noa, { name: 'Reading club', habit: 'reading', species: 'bun' }),
  ];
  // Four years of closed days, a day at a time like the day close writes them: five pages of rows,
  // each pack's sharing the first column.
  const days = Array.from({ length: 1500 }, (_, n) => new Date(Date.UTC(2022, 0, 1 + n)).toISOString().slice(0, 10));
  const rows = days.flatMap((day) =>
    packs.map((pack) => ({ pack_id: pack.id, day, result: 'success' as const, applied: true, health_before: 50, health_after: 60 })),
  );
  const inserted = await admin.from('day_results').insert(rows);
  expect(inserted.error).toBeNull();
  // The statistics a live table has by the time the night's backup runs.
  run('npx supabase db query --local "analyze public.day_results"');

  run(`node scripts/backup.mjs --local --out "${out}"`);

  const file = readdirSync(out).find((name) => name.endsWith('.json'))!;
  const backup = JSON.parse(readFileSync(join(out, file), 'utf8')) as { tables: Record<string, { pack_id: string; day: string }[]> };
  const ours = new Set(packs.map((pack) => pack.id));
  const saved = new Set(
    backup.tables['public.day_results']!.filter((row) => ours.has(row.pack_id)).map((row) => `${row.pack_id} ${row.day}`),
  );
  expect(saved.size).toBe(rows.length);
});
