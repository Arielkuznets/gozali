// The gozali.app site build, run on a copy of what it reads so the real web/dist stays as it is.
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = ['web/build.mjs', 'web/src', 'docs/legal', 'docs/support.md', 'packages/critter-art/src', 'apps/mobile/assets/images/icon.png'];
let site: string;

test.beforeEach(async ({}, testInfo) => {
  site = testInfo.outputPath('site');
  for (const source of SOURCES) cpSync(join(root, source), join(site, source), { recursive: true });
});

function build() {
  return spawnSync(process.execPath, [join(site, 'web/build.mjs')], { encoding: 'utf8' });
}

const page = (path: string) => readFileSync(join(site, 'web/dist', path), 'utf8');

test('the pages the stores link to carry no draft notice', () => {
  const { status, stderr } = build();
  expect(status, stderr).toBe(0);
  for (const path of ['privacy/index.html', 'terms/index.html', 'support/index.html']) {
    expect(page(path)).not.toMatch(/draft/i);
  }
});
