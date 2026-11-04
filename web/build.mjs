// Builds the gozali.app site into web/dist: the landing page, the invite page, the privacy
// policy, terms and support pages (from docs), and the files that let https://gozali.app/i/CODE
// open the app. Run: APP_STORE_URL=... PLAY_STORE_URL=... ANDROID_SHA256=... node web/build.mjs
// A store link that isn't set stays empty, with a warning. The fingerprint has to be the real one,
// because web/dist is what gets deployed. node web/build.mjs --preview needs none of the values and
// builds into web/dist-preview, to look at the pages.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CREATURE_COLORS, CREATURES, renderCritter } from '../packages/critter-art/src/index.ts';

const root = dirname(fileURLToPath(import.meta.url));
const preview = process.argv.includes('--preview');
const dist = join(root, preview ? 'dist-preview' : 'dist');

function setting(name, fallback) {
  const value = process.env[name];
  if (!value) console.warn(`${name} is not set.`);
  return value || fallback;
}

// No store link yet leaves them empty: the landing page shows no store button, and the invite
// page says the app isn't in the stores yet instead of opening a page that doesn't exist.
const appStoreUrl = setting('APP_STORE_URL', '');
const playStoreUrl = setting('PLAY_STORE_URL', '');
// The Apple team is public (it is in the association file anyway), so it has a real default.
const teamId = process.env.APPLE_TEAM_ID || '3DYA8J45VJ';
const androidFingerprint = setting('ANDROID_SHA256', 'SHA256:FINGERPRINT');
// Android compares this with the app's signature before it lets the app open invite links, and a
// mismatch shows up nowhere: the links just open the browser. It wants this exact form.
if (!preview && !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(androidFingerprint)) {
  console.error('ANDROID_SHA256 must be the fingerprint of the key that signs the app, 32 pairs like AB:CD:...');
  console.error('To only look at the pages: node web/build.mjs --preview');
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'src'), dist, { recursive: true });
cpSync(join(root, '../apps/mobile/assets/images/icon.png'), join(dist, 'icon.png'));
// The app's fonts are served from the site itself, so a visit asks nothing of another server. Their
// license (SIL Open Font License) goes with them.
const fonts = join(root, '../node_modules/@expo-google-fonts');
for (const file of [
  'rubik/400Regular/Rubik_400Regular.ttf',
  'rubik/500Medium/Rubik_500Medium.ttf',
  'rubik/700Bold/Rubik_700Bold.ttf',
  'varela-round/400Regular/VarelaRound_400Regular.ttf',
]) {
  cpSync(join(fonts, file), join(dist, 'fonts', basename(file)));
}
cpSync(join(fonts, 'rubik/LICENSE_FONT'), join(dist, 'fonts/Rubik-OFL.txt'));
cpSync(join(fonts, 'varela-round/LICENSE_FONT'), join(dist, 'fonts/VarelaRound-OFL.txt'));

// The six creatures on the landing page, drawn by the same code as the app.
const creatures = CREATURES.map((species) => {
  const name = species[0].toUpperCase() + species.slice(1);
  const art = renderCritter({ species, color: CREATURE_COLORS[species], stage: 'adult', look: 'happy' }, { id: `c-${species}` });
  return `<figure>${art.replace('<svg ', `<svg role="img" aria-label="${name}" `)}<figcaption>${name}</figcaption></figure>`;
}).join('');

// Before the app is in a store, its button would lead nowhere.
const storeButtons =
  [
    appStoreUrl && `<a class="button" href="${appStoreUrl}">Download for iPhone</a>`,
    playStoreUrl && `<a class="button secondary" href="${playStoreUrl}">Get it on Google Play</a>`,
  ]
    .filter(Boolean)
    .join('') || '<p class="muted">Coming soon to iPhone and Android.</p>';

for (const page of ['index.html', 'invite/index.html']) {
  const file = join(dist, page);
  const html = readFileSync(file, 'utf8')
    .replaceAll('{{APP_STORE_URL}}', appStoreUrl)
    .replaceAll('{{PLAY_STORE_URL}}', playStoreUrl)
    .replaceAll('{{CREATURES}}', creatures)
    .replaceAll('{{STORE_BUTTONS}}', storeButtons);
  writeFileSync(file, html);
}

// The legal and support pages come from Markdown in docs, which uses headings, paragraphs,
// lists and bold text only.
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
  ['privacy', 'legal/privacy-policy.md', 'Privacy Policy'],
  ['terms', 'legal/terms-of-use.md', 'Terms of Use'],
  ['support', 'support.md', 'Support'],
]) {
  const body = markdown(readFileSync(join(root, '../docs', source), 'utf8'));
  mkdirSync(join(dist, folder), { recursive: true });
  writeFileSync(
    join(dist, folder, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gozali ${title}</title><link rel="icon" href="/icon.png"><link rel="stylesheet" href="/style.css"></head><body><main><article>${body}</article><footer class="muted"><a href="/">Gozali</a> · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a> · <a href="/support/">Support</a></footer></main></body></html>\n`,
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

// Cloudflare style rules: every invite path shows the invite page (kept outside /i/, so the rule
// can't match its own target), and the association file is JSON even without an extension.
writeFileSync(join(dist, '_redirects'), '/i/*  /invite/  200\n');
// Security headers for every page. The invite page's one inline script is allowed by its hash, so
// the policy needs no 'unsafe-inline', and the styles and fonts are the site's own.
const scriptHashes = [...readFileSync(join(dist, 'invite/index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
);
const policy = [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.join(' ')}`,
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');
writeFileSync(
  join(dist, '_headers'),
  [
    '/*',
    `  Content-Security-Policy: ${policy}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/.well-known/apple-app-site-association',
    '  Content-Type: application/json',
    '',
  ].join('\n'),
);
console.log(`built ${dist}`);
