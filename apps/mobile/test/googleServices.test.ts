type Config = { name: string; android?: Record<string, unknown> };

let mockFileHere: boolean;
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: (path: string) => (path === './google-services.json' ? mockFileHere : jest.requireActual('node:fs').existsSync(path)),
}));

/** The config as EAS and expo prebuild read it. */
const appConfig = jest.requireActual<(context: { config: Config }) => Config>('../app.config.js');

const config: Config = { name: 'Gozali', android: { package: 'app.gozali' } };
const environment = { ...process.env };

beforeEach(() => {
  mockFileHere = false;
  delete process.env.GOOGLE_SERVICES_JSON;
  delete process.env.EAS_BUILD_PLATFORM;
});

afterAll(() => {
  process.env = environment;
});

describe("Firebase's file for Android push", () => {
  it('stops an Android EAS build that has none, whose phones would never get a push token', () => {
    process.env.EAS_BUILD_PLATFORM = 'android';

    expect(() => appConfig({ config })).toThrow('GOOGLE_SERVICES_JSON');
  });

  it('goes into the config from the EAS file variable', () => {
    process.env.EAS_BUILD_PLATFORM = 'android';
    process.env.GOOGLE_SERVICES_JSON = '/home/expo/workingdir/google-services.json';

    expect(appConfig({ config }).android).toEqual({ package: 'app.gozali', googleServicesFile: '/home/expo/workingdir/google-services.json' });
  });

  it('goes into the config from the file next to it, for a build on this computer', () => {
    mockFileHere = true;
    process.env.EAS_BUILD_PLATFORM = 'android';

    expect(appConfig({ config }).android).toEqual({ package: 'app.gozali', googleServicesFile: './google-services.json' });
  });

  it('is not needed for an iOS build, or where EAS reads the config on a computer', () => {
    process.env.EAS_BUILD_PLATFORM = 'ios';
    expect(appConfig({ config })).toEqual(config);

    delete process.env.EAS_BUILD_PLATFORM;
    expect(appConfig({ config })).toEqual(config);
  });
});
