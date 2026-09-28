// The release lint of the Expo modules runs out of Gradle's default 512 MB of metaspace
// (OutOfMemoryError: Metaspace in lintVitalAnalyzeRelease), so release builds get more room.
const { withGradleProperties } = require('expo/config-plugins');

const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter((item) => !(item.type === 'property' && item.key === 'org.gradle.jvmargs'));
    config.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    return config;
  });
};
