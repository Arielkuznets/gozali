// app.json holds the config; this adds what can't live in the public repo. Android push goes
// through Firebase, whose google-services.json comes from an EAS file variable
// (GOOGLE_SERVICES_JSON) or, for local builds, an untracked file next to this one.
const { existsSync } = require('node:fs');

module.exports = ({ config }) => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);
  // An Android build without it passes, and its phones never get a push token. EAS sets the
  // platform only on its build servers, not where it reads this config on a computer.
  if (!googleServicesFile && process.env.EAS_BUILD_PLATFORM === 'android') {
    throw new Error(
      'This Android build has no google-services.json, so its phones would get no push notifications: ' +
        'set the GOOGLE_SERVICES_JSON file variable for this EAS environment (docs/setup.md).',
    );
  }
  return googleServicesFile ? { ...config, android: { ...config.android, googleServicesFile } } : config;
};
