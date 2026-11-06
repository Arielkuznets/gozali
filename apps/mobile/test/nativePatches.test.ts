// patch-package rewrites a package's files in node_modules as it installs. The iOS build links some
// Expo modules from a framework they ship already compiled, which never sees those files.
const { existsSync, readdirSync, readFileSync } = jest.requireActual('node:fs');

/** The packages under patches/, whose files are named <package>+<version>.patch. */
const patched: string[] = readdirSync('../../patches')
  .filter((file: string) => file.endsWith('.patch'))
  .map((file: string) => file.slice(0, file.lastIndexOf('+')).replace('+', '/'));

const shipsPrebuiltForIos = (name: string) => existsSync(`../../node_modules/${name}/prebuilds/output/release/xcframeworks`);

const buildFromSource: string[] = JSON.parse(readFileSync('package.json', 'utf8')).expo?.autolinking?.buildFromSource ?? [];

describe('a native module patched at install', () => {
  it('is compiled from its patched files on iOS, also where it ships prebuilt', () => {
    expect(buildFromSource).toEqual(expect.arrayContaining(patched.filter(shipsPrebuiltForIos)));
  });
});
