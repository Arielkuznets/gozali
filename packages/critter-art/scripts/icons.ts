// Draws the app icons from the critter itself: node scripts/icons.ts [output folder]
// (defaults to apps/mobile/assets/images). Run it again whenever the drawing changes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import { CREATURE_COLORS, renderCritter, type CritterArt } from '../src/index.ts';

const output = process.argv[2] ?? join(import.meta.dirname, '../../../apps/mobile/assets/images');
const CREAM = '#FBF6EE';
const CRITTER: CritterArt = { species: 'mochi', color: CREATURE_COLORS.mochi, stage: 'adult', look: 'happy' };
// The critter's middle in its own 200 x 200 drawing, so it can be centered on a canvas.
const CENTER = { x: 100, y: 122 };

/** The critter at `scale` (canvas pixels per drawing unit), centered on a square canvas. */
function canvas(size: number, scale: number, options: { background?: string; monochrome?: boolean } = {}): string {
  let inner = renderCritter(CRITTER).replace(
    /^<svg[^>]*>/,
    `<svg x="${size / 2 - CENTER.x * scale}" y="${size / 2 - CENTER.y * scale}" width="${200 * scale}" height="${200 * scale}" viewBox="0 0 200 200">`,
  );
  if (options.monochrome) {
    // Android themed icons use a single-color silhouette.
    inner = inner.replace(/(fill|stroke|stop-color)="#[0-9A-Fa-f]{6}"/g, '$1="#FFFFFF"');
  }
  const background = options.background ? `<rect width="${size}" height="${size}" fill="${options.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}${inner}</svg>`;
}

function write(name: string, svg: string) {
  const png = new Resvg(svg, { background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(join(output, name), png);
  console.log(`wrote ${name}`);
}

// iOS and the stores: square and opaque; the system rounds the corners.
write('icon.png', canvas(1024, 4.4, { background: CREAM }));
// Android adaptive icon: the critter stays inside the middle 66% that every mask keeps.
write('android-icon-foreground.png', canvas(1024, 2.9));
write('android-icon-background.png', `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${CREAM}"/></svg>`);
write('android-icon-monochrome.png', canvas(1024, 2.9, { monochrome: true }));
write('splash-icon.png', canvas(1024, 4.4));
write('favicon.png', canvas(48, 0.21, { background: CREAM }));
