import config from '../app.json';

// The share sheet of the weekly story offers Save Image, and iOS writes to Photos only for an app
// that says why it wants to.
describe('saving a picture to the photo library', () => {
  it('has a purpose string of its own on iOS', () => {
    const infoPlist: Record<string, unknown> = config.expo.ios.infoPlist;
    expect(infoPlist.NSPhotoLibraryAddUsageDescription).toContain('story');
  });
});
