// The gozali.app site build, run on a copy of what it reads so the real web/dist stays as it is.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = [
  'web/build.mjs',
  'web/src',
  'docs/legal',
  'docs/support.md',
  'packages/critter-art/src',
  'apps/mobile/assets/images/icon.png',
  'node_modules/@expo-google-fonts/rubik/400Regular/Rubik_400Regular.ttf',
  'node_modules/@expo-google-fonts/rubik/500Medium/Rubik_500Medium.ttf',
  'node_modules/@expo-google-fonts/rubik/700Bold/Rubik_700Bold.ttf',
  'node_modules/@expo-google-fonts/rubik/LICENSE_FONT',
  'node_modules/@expo-google-fonts/varela-round/400Regular/VarelaRound_400Regular.ttf',
  'node_modules/@expo-google-fonts/varela-round/LICENSE_FONT',
];
// Google's example of a certificate fingerprint.
const FINGERPRINT = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
let site: string;

test.beforeEach(async ({}, testInfo) => {
  site = testInfo.outputPath('site');
  for (const source of SOURCES) cpSync(join(root, source), join(site, source), { recursive: true });
});

function build(fingerprint?: string, ...flags: string[]) {
  const env = { ...process.env, ANDROID_SHA256: fingerprint ?? '' };
  return spawnSync(process.execPath, [join(site, 'web/build.mjs'), ...flags], { encoding: 'utf8', env });
}

const page = (path: string, folder = 'dist') => readFileSync(join(site, 'web', folder, path), 'utf8');

const fingerprints = (folder?: string) =>
  (JSON.parse(page('.well-known/assetlinks.json', folder)) as { target: { sha256_cert_fingerprints: string[] } }[])[0]!.target
    .sha256_cert_fingerprints;

test('the pages the stores link to carry no draft notice', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  for (const path of ['privacy/index.html', 'terms/index.html', 'support/index.html']) {
    expect(page(path)).not.toMatch(/draft/i);
  }
});

test('the support page tells someone without the app how to have the account deleted', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  // Google Play takes this page as the link for deleting an account only if it works without the app.
  const deletion = /<li><strong>Deleting your account:<\/strong>(.*?)<\/li>/.exec(page('support/index.html'))?.[1];
  expect(deletion).toContain('Settings → Delete account');
  expect(deletion).toContain('hello@gozali.app');
  // Only the account's own address can have it deleted, and an Apple account that hid its email
  // holds an address its owner has to look up.
  expect(deletion).toMatch(/confirm/i);
  expect(deletion).toContain('Hide My Email');
});

test('the support page says a pause covers only the person who takes it', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  // A pause is saved for the member who starts it: the rest of the pack is still counted.
  const support = page('support/index.html');
  expect(support).not.toMatch(/pause the pack/i);
  const away = /<li><strong>What if I can't do my habit one day\?<\/strong>(.*?)<\/li>/.exec(support)?.[1];
  expect(away).toContain('pause yourself');
  expect(away).toContain('pauses on their own');
});

test('the privacy policy says how a deletion by email is confirmed', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  const rights = /<h2>Your rights<\/h2>\n<p>(.*?)<\/p>/.exec(page('privacy/index.html'))?.[1];
  expect(rights).toContain('hello@gozali.app');
  expect(rights).toMatch(/confirm/i);
  expect(rights).toContain('Hide My Email');
});

test('the privacy policy names the update check the app sends Expo on every start', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  // With an update URL and the default check on launch, expo-updates asks Expo for a newer version
  // every time the app starts, with an id it keeps for the installation and, after an error that
  // stopped the app while it was starting, that error.
  const { updates } = JSON.parse(readFileSync(join(root, 'apps/mobile/app.json'), 'utf8')).expo;
  expect(updates?.url).toMatch(/^https:\/\/u\.expo\.dev\//);
  expect(updates?.checkOnLaunch ?? 'ALWAYS').toBe('ALWAYS');
  const expo = /<li><strong>Expo<\/strong>(.*?)<\/li>/.exec(page('privacy/index.html'))?.[1];
  expect(expo).toContain('updates');
  expect(expo).toContain('installation');
  expect(expo).toContain('error');
});

test('the privacy policy confirms the services it names protect the data as well as it does', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  // App Review guideline 5.1.1(i) asks the policy to confirm it of everyone who gets members' data.
  const privacy = page('privacy/index.html');
  const services = privacy.slice(privacy.indexOf('<h2>Services we use</h2>'), privacy.indexOf('<h2>Your rights</h2>'));
  expect(services).toContain('Supabase');
  expect(services).toMatch(/same or equal protection/i);
});

test('the real fingerprint goes into the file Android reads', () => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  expect(fingerprints()).toEqual([FINGERPRINT]);
});

for (const [name, value] of [
  ['no fingerprint', undefined],
  ['the placeholder', 'SHA256:FINGERPRINT'],
  ['a fingerprint with the prefix keytool prints', `SHA256:${FINGERPRINT}`],
  ['a fingerprint in lower case', FINGERPRINT.toLowerCase()],
] as const) {
  test(`a build with ${name} is refused and leaves the site as it was`, () => {
    mkdirSync(join(site, 'web/dist'));
    writeFileSync(join(site, 'web/dist/index.html'), 'the site that is up');

    const { status, stderr } = build(value);

    expect(status).toBe(1);
    expect(stderr).toContain('ANDROID_SHA256');
    expect(page('index.html')).toBe('the site that is up');
  });
}

/** Serves a built site as Cloudflare does: a folder by its index.html, and every invite path by the invite page. */
async function serve(folder: string) {
  const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
  const server = createServer((request, response) => {
    let path = new URL(request.url ?? '/', 'http://site').pathname;
    if (path.startsWith('/i/')) path = '/invite/';
    if (path.endsWith('/')) path += 'index.html';
    try {
      response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(join(folder, path)));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test('a visit asks nothing of another server, fonts included', async ({ page }) => {
  const { status, stderr } = build(FINGERPRINT);
  expect(status, stderr).toBe(0);
  const hosted = await serve(join(site, 'web/dist'));
  const elsewhere: string[] = [];
  await page.route(
    (url) => url.origin !== hosted.origin,
    (route) => {
      elsewhere.push(route.request().url());
      return route.abort();
    },
  );
  try {
    for (const path of ['/', '/i/ABCD2345', '/privacy/']) {
      await page.goto(hosted.origin + path);
      expect(elsewhere, path).toEqual([]);
      const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        const families: string[] = [];
        document.fonts.forEach((face) => {
          if (face.status === 'loaded') families.push(face.family.replaceAll('"', ''));
        });
        return families;
      });
      expect(new Set(loaded), path).toEqual(new Set(['Rubik', 'Varela Round']));
    }
  } finally {
    hosted.close();
  }
});

test('a preview builds without the fingerprint, outside the folder that gets deployed', () => {
  const { status, stderr } = build(undefined, '--preview');
  expect(status, stderr).toBe(0);
  expect(fingerprints('dist-preview')).toEqual(['SHA256:FINGERPRINT']);
  expect(existsSync(join(site, 'web/dist'))).toBe(false);
});
