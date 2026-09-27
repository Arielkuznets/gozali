// Writes an HTML contact sheet of critters for eyeballing the drawings:
// node scripts/preview.ts [output.html]
import { writeFileSync } from 'node:fs';

import { CRITTER_PALETTE, renderCritter, type CritterArt } from '../src/index.ts';

const species = ['blob', 'spark', 'mossy'] as const;
const looks = ['thriving', 'happy', 'hungry', 'weak', 'sick'] as const;
const stages = ['baby', 'kid', 'teen', 'adult', 'legend'] as const;
const colors = Object.values(CRITTER_PALETTE);

const rows: { title: string; items: { label: string; art: CritterArt }[] }[] = [
  {
    title: 'Health states (adult)',
    items: species.flatMap((s, i) =>
      looks.map((look) => ({ label: `${s} ${look}`, art: { species: s, color: colors[i] ?? '#F6C9A8', stage: 'adult', look } })),
    ),
  },
  {
    title: 'Stages',
    items: species.flatMap((s, i) =>
      stages.map((stage) => ({ label: `${s} ${stage}`, art: { species: s, color: colors[i + 3] ?? '#F6C9A8', stage, look: 'happy' } })),
    ),
  },
  {
    title: 'Moments',
    items: [
      { label: 'egg', art: { species: 'blob', color: colors[0]!, stage: 'egg', look: 'egg' } },
      { label: 'egg cracking', art: { species: 'blob', color: colors[3]!, stage: 'egg', look: 'egg', cracking: true } },
      { label: 'ran away', art: { species: 'blob', color: colors[0]!, stage: 'kid', look: 'ran_away' } },
      { label: 'sleeping', art: { species: 'spark', color: colors[3]!, stage: 'teen', look: 'happy', sleeping: true } },
      { label: 'blinking', art: { species: 'mossy', color: colors[2]!, stage: 'teen', look: 'happy', blinking: true } },
      { label: 'hungry, all fed', art: { species: 'spark', color: colors[4]!, stage: 'kid', look: 'hungry', mood: 1 } },
      { label: 'happy, half fed', art: { species: 'mossy', color: colors[1]!, stage: 'kid', look: 'happy', mood: 0.5 } },
      { label: 'holiday', art: { species: 'spark', color: colors[0]!, stage: 'teen', look: 'happy', holiday: true } },
      { label: 'looking left', art: { species: 'blob', color: colors[3]!, stage: 'teen', look: 'happy', gaze: { x: -1, y: 0.3 } } },
      { label: 'holiday mossy', art: { species: 'mossy', color: colors[2]!, stage: 'adult', look: 'thriving', holiday: true } },
    ],
  },
  {
    title: 'Wardrobe, habit items and marks',
    items: [
      { label: 'beanie + scarf + gym', art: { species: 'blob', color: colors[0]!, stage: 'teen', look: 'happy', outfit: { head: 'beanie', neck: 'scarf' }, categoryItem: 'dumbbell' } },
      { label: 'flower crown + bow tie + reading', art: { species: 'spark', color: colors[4]!, stage: 'adult', look: 'thriving', outfit: { head: 'flower_crown', neck: 'bow_tie' }, categoryItem: 'glasses' } },
      { label: 'sun hat + sunrise + running', art: { species: 'mossy', color: colors[1]!, stage: 'adult', look: 'happy', outfit: { head: 'sun_hat', background: 'sunrise' }, categoryItem: 'sneakers' } },
      { label: 'headlamp + cape + study', art: { species: 'blob', color: colors[3]!, stage: 'adult', look: 'happy', outfit: { head: 'headlamp', neck: 'cape', background: 'space' }, categoryItem: 'headphones' } },
      { label: 'halo + park + water', art: { species: 'spark', color: colors[2]!, stage: 'legend', look: 'thriving', outfit: { head: 'halo', background: 'park' }, categoryItem: 'bottle' } },
      { label: 'party + medal + bandage', art: { species: 'mossy', color: colors[5]!, stage: 'adult', look: 'happy', outfit: { background: 'party', neck: 'scarf' }, marks: ['medal', 'bandage'] } },
      { label: 'sick with outfit', art: { species: 'blob', color: colors[0]!, stage: 'adult', look: 'sick', outfit: { head: 'beanie', neck: 'scarf' }, marks: ['bandage'] } },
    ],
  },
];

const html = `<!doctype html><meta charset="utf-8"><title>Critters</title>
<style>body{font-family:system-ui;background:#FBF6EE;color:#3B2F2A;margin:16px}h2{font-size:15px;margin:18px 0 6px}
.row{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;width:130px;text-align:center;font-size:11px}
figure div{width:130px;height:130px;background:#FFFDF9;border-radius:14px}svg{width:130px;height:130px}</style>
${rows
  .map(
    (row) =>
      `<h2>${row.title}</h2><div class="row">${row.items
        .map((item) => `<figure><div>${renderCritter(item.art)}</div><figcaption>${item.label}</figcaption></figure>`)
        .join('')}</div>`,
  )
  .join('')}`;

const output = process.argv[2] ?? 'critters.html';
writeFileSync(output, html);
console.log(`wrote ${output}`);
