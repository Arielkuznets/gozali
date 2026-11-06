import config from '../app.json';

/** The options of a config plugin. */
function pluginOptions(name: string) {
  const entry = config.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
  return entry?.[1] as { cameraPermission?: string } | undefined;
}

// Both plugins write NSCameraUsageDescription, and whichever runs last wins.
describe('the camera purpose string', () => {
  const camera = pluginOptions('expo-camera')?.cameraPermission;
  const picker = pluginOptions('expo-image-picker')?.cameraPermission;

  it('is the same in both plugins, so their order does not matter', () => {
    expect(camera).toBe(picker);
  });

  it('names both uses of the camera', () => {
    expect(camera).toContain('feeds your pack');
    expect(camera).toContain('profile picture');
  });
});
