// The gozali.app site build, run on a copy of what it reads so the real web/dist stays as it is.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = ['web/build.mjs', 'web/src', 'docs/legal', 'docs/support.md', 'packages/critter-art/src', 'apps/mobile/assets/images/icon.png'];
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

test('a preview builds without the fingerprint, outside the folder that gets deployed', () => {
  const { status, stderr } = build(undefined, '--preview');
  expect(status, stderr).toBe(0);
  expect(fingerprints('dist-preview')).toEqual(['SHA256:FINGERPRINT']);
  expect(existsSync(join(site, 'web/dist'))).toBe(false);
});
