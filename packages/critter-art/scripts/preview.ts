// Writes an HTML contact sheet of every creature in every state, for eyeballing the drawings:
// node scripts/preview.ts [output.html]
import { writeFileSync } from 'node:fs';

import { CREATURE_COLORS, CREATURES, renderCritter, type CritterArt } from '../src/index.ts';

type State = Omit<CritterArt, 'species' | 'color'>;

const columns: [string, State][] = [
  ['egg', { stage: 'egg', look: 'egg' }],
  ['cracking', { stage: 'egg', look: 'egg', cracking: true }],
  ['baby', { stage: 'baby', look: 'happy' }],
  ['kid, all fed', { stage: 'kid', look: 'happy', mood: 1 }],
  ['teen thriving', { stage: 'teen', look: 'thriving' }],
  ['hungry', { stage: 'adult', look: 'hungry' }],
  ['weak', { stage: 'adult', look: 'weak' }],
  ['sick', { stage: 'adult', look: 'sick' }],
  ['asleep', { stage: 'adult', look: 'happy', sleeping: true }],
  ['yawn', { stage: 'adult', look: 'happy', yawning: true }],
  ['looking left', { stage: 'adult', look: 'happy', gaze: { x: -1, y: 0.3 } }],
  ['beanie, scarf, reading', { stage: 'adult', look: 'happy', outfit: { head: 'beanie', neck: 'scarf' }, categoryItem: 'glasses' }],
  ['sun hat, bow tie, gym', { stage: 'adult', look: 'happy', outfit: { head: 'sun_hat', neck: 'bow_tie' }, categoryItem: 'dumbbell' }],
  ['crown, park, study', { stage: 'teen', look: 'happy', outfit: { head: 'flower_crown', background: 'park' }, categoryItem: 'headphones' }],
  ['headlamp, space, water', { stage: 'adult', look: 'happy', outfit: { head: 'headlamp', background: 'space' }, categoryItem: 'bottle' }],
  ['legend: halo, cape, marks', { stage: 'legend', look: 'thriving', outfit: { head: 'halo', neck: 'cape' }, marks: ['medal', 'bandage'] }],
  ['holiday, running', { stage: 'adult', look: 'happy', holiday: true, categoryItem: 'sneakers' }],
  ['ran away', { stage: 'adult', look: 'ran_away' }],
];

const html = `<!doctype html><meta charset="utf-8"><title>Critters</title>
<style>body{font-family:system-ui;background:#FBF6EE;color:#3B2F2A;margin:16px}table{border-spacing:6px}
th{font-weight:500;color:#7A6A60;font-size:11px;width:120px}td{background:#F1E7DA;border-radius:14px;width:120px;height:120px;text-align:center}
td.name{background:none;width:60px;font-size:14px}svg{width:116px;height:116px}</style>
<table><tr><th></th>${columns.map(([label]) => `<th>${label}</th>`).join('')}</tr>
${CREATURES.map(
  (species) =>
    `<tr><td class="name">${species}</td>${columns
      .map(([, state]) => `<td>${renderCritter({ species, color: CREATURE_COLORS[species], ...state })}</td>`)
      .join('')}</tr>`,
).join('\n')}
</table>`;

const output = process.argv[2] ?? 'critters.html';
writeFileSync(output, html);
console.log(`wrote ${output}`);
