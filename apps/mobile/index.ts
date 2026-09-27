// The app's entry: Expo Router, plus the Android widget handlers, which Android starts on its
// own (in the background, or for the widget's settings screen) without opening the app.
import 'expo-router/entry';

import { Platform } from 'react-native';
import { registerWidgetConfigurationScreen, registerWidgetTaskHandler } from 'react-native-android-widget';

import { WidgetConfigurationScreen } from '@/features/widgets/android/configure';
import { widgetTaskHandler } from '@/features/widgets/android/task';

if (Platform.OS === 'android') {
  registerWidgetTaskHandler(widgetTaskHandler);
  registerWidgetConfigurationScreen(WidgetConfigurationScreen);
}
