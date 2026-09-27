// The iOS widget extension (spec section 9, decision D9), built by @bacons/apple-targets.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'GozaliWidget',
  displayName: 'Gozali',
  // App Intent configuration (choosing the pack) and containerBackground need iOS 17.
  deploymentTarget: '17.0',
  colors: {
    $accent: '#E8795A',
    $widgetBackground: '#FBF6EE',
  },
  entitlements: {
    // The same App Group as the app, where it leaves the snapshot and the widget token.
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
