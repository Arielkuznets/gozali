// Builds the gozali.app site into web/dist: the landing page, the invite page, the privacy
// policy and terms (from docs/legal), and the files that let https://gozali.app/i/CODE open the
// app. Run: APP_STORE_URL=... APPLE_TEAM_ID=... ANDROID_SHA256=... node web/build.mjs
// Missing values become placeholders, with a warning, so a preview build still works.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CREATURE_COLORS, CREATURES, renderCritter } from '../packages/critter-art/src/index.ts';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

function setting(name, fallback) {
  const value = process.env[name];
  if (!value) console.warn(`${name} is not set; using a placeholder.`);
  return value || fallback;
}

const appStoreUrl = setting('APP_STORE_URL', 'https://apps.apple.com/app/gozali');
const teamId = setting('APPLE_TEAM_ID', 'TEAMID');
const androidFingerprint = setting('ANDROID_SHA256', 'SHA256:FINGERPRINT');

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'src'), dist, { recursive: true });
cpSync(join(root, '../apps/mobile/assets/images/icon.png'), join(dist, 'icon.png'));

// The six creatures on the landing page, drawn by the same code as the app.
const creatures = CREATURES.map((species) => {
  const name = species[0].toUpperCase() + species.slice(1);
  const art = renderCritter({ species, color: CREATURE_COLORS[species], stage: 'adult', look: 'happy' }, { id: `c-${species}` });
  return `<figure>${art.replace('<svg ', `<svg role="img" aria-label="${name}" `)}<figcaption>${name}</figcaption></figure>`;
}).join('');

for (const page of ['index.html', 'i/index.html']) {
  const file = join(dist, page);
  const html = readFileSync(file, 'utf8').replaceAll('{{APP_STORE_URL}}', appStoreUrl).replaceAll('{{CREATURES}}', creatures);
  writeFileSync(file, html);
}

// The legal pages come from the Markdown in docs/legal, which uses headings, paragraphs,
// lists, a quote and bold text only.
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (text) => escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function markdown(source) {
  const html = [];
  let list = false;
  for (const line of source.split(/\r?\n/)) {
    if (list && !line.startsWith('- ')) {
      html.push('</ul>');
      list = false;
    }
    if (line.startsWith('# ')) html.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) html.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('> ')) html.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.startsWith('- ')) {
      if (!list) html.push('<ul>');
      list = true;
      html.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  if (list) html.push('</ul>');
  return html.join('\n');
}

for (const [folder, source, title] of [
  ['privacy', 'privacy-policy.md', 'Privacy Policy'],
  ['terms', 'terms-of-use.md', 'Terms of Use'],
]) {
  const body = markdown(readFileSync(join(root, '../docs/legal', source), 'utf8'));
  mkdirSync(join(dist, folder), { recursive: true });
  writeFileSync(
    join(dist, folder, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gozali ${title}</title><link rel="icon" href="/icon.png"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Varela+Round&display=swap"><link rel="stylesheet" href="/style.css"></head><body><main><article>${body}</article><footer class="muted"><a href="/">Gozali</a></footer></main></body></html>\n`,
  );
}

// Universal links (iOS) and app links (Android) for /i/CODE.
mkdirSync(join(dist, '.well-known'), { recursive: true });
writeFileSync(
  join(dist, '.well-known/apple-app-site-association'),
  JSON.stringify({ applinks: { details: [{ appIDs: [`${teamId}.app.gozali`], components: [{ '/': '/i/*' }] }] } }, null, 2),
);
writeFileSync(
  join(dist, '.well-known/assetlinks.json'),
  JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'app.gozali', sha256_cert_fingerprints: [androidFingerprint] },
      },
    ],
    null,
    2,
  ),
);

// Cloudflare Pages / Netlify style rules: every invite path serves the invite page, and the
// association file is JSON even without an extension.
writeFileSync(join(dist, '_redirects'), '/i/*  /i/index.html  200\n');
writeFileSync(join(dist, '_headers'), '/.well-known/apple-app-site-association\n  Content-Type: application/json\n');
console.log(`built ${dist}`);
