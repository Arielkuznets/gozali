// app.json holds the config; this adds what can't live in the public repo. Android push goes
// through Firebase, whose google-services.json comes from an EAS file variable
// (GOOGLE_SERVICES_JSON) or, for local builds, an untracked file next to this one.
const { existsSync } = require('node:fs');

module.exports = ({ config }) => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);
  return googleServicesFile ? { ...config, android: { ...config.android, googleServicesFile } } : config;
};
