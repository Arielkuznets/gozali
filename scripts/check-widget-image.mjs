// Draws a widget picture from the bundle a deploy makes, with no network at all, so the picture
// can't come to depend on a download. The database is the same process answering the one RPC the
// function makes.
// Needs Docker and the edge-runtime image that `npx supabase start` pulls:
// node scripts/check-widget-image.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });

const image = docker('images', '--format', '{{.Repository}}:{{.Tag}}')
  .split('\n')
  .find((line) => line.includes('/edge-runtime:'));
if (!image) throw new Error('No edge-runtime image; run `npx supabase start` first.');

const state = {
  timezone: 'UTC',
  packs: [
    {
      id: 'a-pack',
      name: 'Walkers',
      category: 'walking',
      dayEndsAt: '2026-11-02T01:00:00Z',
      daysRunning: true,
      iFed: false,
      members: ['fed', 'waiting'],
      critter: { name: null, species: 'axo', health: 80, stage: 'baby', status: 'active', streak: 1, marks: [], outfit: null },
    },
  ],
};

const mainService = `
const base = 'http://127.0.0.1:8081';
Deno.serve({ port: 8081 }, async (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === '/rest/v1/rpc/widget_state') return Response.json(${JSON.stringify(state)});
  if (pathname !== '/check') return new Response('no route', { status: 404 });
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: '/app/supabase/functions/widget-state',
    memoryLimitMb: 256,
    workerTimeoutMs: 30_000,
    noModuleCache: false,
    importMapPath: null,
    envVars: [['SUPABASE_URL', base], ['SUPABASE_SERVICE_ROLE_KEY', 'not-a-key']],
    forceCreate: true,
    cpuTimeSoftLimitMs: 1000,
    cpuTimeHardLimitMs: 2000,
    maybeEszip: await Deno.readFile('/root/main/bundle.eszip'),
    maybeEntrypoint: 'file:///app/supabase/functions/widget-state/index.ts',
    context: { useReadSyncFileAPI: true },
  });
  const inner = new Request(base + '/widget-state?image=a-pack', { headers: { 'x-widget-token': 'a-token' } });
  EdgeRuntime.applySupabaseTag(request, inner);
  return await worker.fetch(inner);
});
setTimeout(async () => {
  const answer = await fetch(base + '/check');
  const bytes = new Uint8Array(await answer.arrayBuffer());
  console.log('RESULT ' + answer.status + ' ' + bytes.length + ' ' + answer.headers.get('content-type'));
}, 300);
`;

const work = mkdtempSync(join(tmpdir(), 'gozali-widget-image-'));
const container = `gozali_widget_image_${process.pid}`;
let result;
let logs = '';
try {
  writeFileSync(join(work, 'index.ts'), mainService);
  docker(
    'run', '--rm',
    '-v', `${root}:/app:ro`,
    '-v', 'gozali-deno-cache:/root/.cache/deno',
    '-v', `${work}:/work`,
    '--entrypoint', 'edge-runtime',
    image,
    'bundle', '--entrypoint', '/app/supabase/functions/widget-state/index.ts', '--output', '/work/bundle.eszip',
  );
  docker(
    'run', '-d', '--name', container,
    '--network', 'none',
    '-v', `${work}:/root/main:ro`,
    '--entrypoint', 'edge-runtime',
    image,
    'start', '--main-service=/root/main', '--port=8081', '--policy=per_worker',
  );
  for (let tries = 0; tries < 120 && !result; tries++) {
    await new Promise((done) => setTimeout(done, 500));
    const { stdout, stderr } = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
    logs = stdout + stderr;
    result = logs.split('\n').find((line) => line.startsWith('RESULT'));
  }
} finally {
  try {
    docker('rm', '-f', container);
  } catch {
    // The container never started: the bundle failed, and its error is the one that matters.
  }
  rmSync(work, { recursive: true, force: true });
}

if (!/^RESULT 200 \d{4,} image\/png$/.test(result ?? '')) {
  console.error(`not ok - no picture with the network off: ${result ?? 'no answer'}`);
  console.error(logs);
  process.exit(1);
}
console.log(`ok - a picture with the network off: ${result}`);
