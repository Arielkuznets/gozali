import { createElement, type ComponentType } from 'react';

import { widgetPack, type WidgetPackRow } from '../../../supabase/functions/widget-state/state.ts';

// The widget library calls these components as plain functions, outside any React render, and Jest
// runs with the React Compiler off. So this compiles the file the way an Android build does.
const { transformSync } = jest.requireActual('@babel/core');
const { readFileSync } = jest.requireActual('node:fs');
const { buildWidgetTree } = jest.requireActual('react-native-android-widget/lib/commonjs/api/build-widget-tree');

const file = 'src/features/widgets/android/widgets.tsx';

function compiledForAndroid() {
  const { code } = transformSync(readFileSync(file, 'utf8'), {
    babelrc: false,
    configFile: false,
    filename: file,
    presets: ['babel-preset-expo'],
    caller: { name: 'metro', bundler: 'metro', platform: 'android', isDev: false, supportsReactCompiler: true },
  });
  const loaded = { exports: {} as Record<string, ComponentType<never>> };
  new Function('require', 'module', 'exports', code)(jest.requireActual, loaded, loaded.exports);
  return loaded.exports;
}

const row: WidgetPackRow = {
  id: 'p1',
  name: 'Runners',
  category: 'running',
  dayEndsAt: '2026-11-02T01:00:00Z',
  daysRunning: true,
  critter: { species: 'mochi', health: 72, stage: 'baby', status: 'active', marks: [], outfit: null, name: 'Momo', streak: 4 },
  iFed: false,
  members: ['fed', 'waiting', 'pass', 'away'],
};
const pack = widgetPack(row, '2026-11-01');

describe('the Android widgets in a build', () => {
  const widgets = compiledForAndroid();

  it.each([
    ['SignedOutWidget', {}],
    ['PackWidget', { pack }],
    ['PackWideWidget', { pack }],
    ['AllPacksWidget', { packs: [pack] }],
  ])('%s draws without a React render', (name, props) => {
    expect(() => buildWidgetTree(createElement(widgets[name], props as never))).not.toThrow();
  });
});
