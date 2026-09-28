// Bundles every Edge Function with the edge-runtime bundler that deploys use, with the whole repo
// visible, so an import the cloud can't resolve (decision D13) fails here first. Each function
// needs its own deno.json; without one, Deno finds the root package.json and looks for npm
// packages in node_modules instead of fetching them.
// Needs Docker and the edge-runtime image that `npx supabase start` pulls:
// node scripts/bundle-functions.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const functionsDir = join(root, 'supabase', 'functions');

const image = execFileSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' })
  .split('\n')
  .find((line) => line.includes('/edge-runtime:'));
if (!image) throw new Error('No edge-runtime image; run `npx supabase start` first.');

const names = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(functionsDir, entry.name, 'index.ts')))
  .map((entry) => entry.name);

let failed = 0;
for (const name of names) {
  if (!existsSync(join(functionsDir, name, 'deno.json'))) {
    console.error(`not ok - ${name}: no deno.json`);
    failed++;
    continue;
  }
  try {
    execFileSync(
      'docker',
      [
        'run', '--rm',
        '-v', `${root}:/app:ro`,
        '-v', 'gozali-deno-cache:/root/.cache/deno',
        '--entrypoint', 'edge-runtime',
        image,
        'bundle', '--entrypoint', `/app/supabase/functions/${name}/index.ts`, '--output', '/tmp/bundle.eszip',
      ],
      { stdio: 'pipe' },
    );
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}\n${error.stderr?.toString() ?? error}`);
    failed++;
  }
}
if (failed > 0) process.exit(1);
console.log('all good');
