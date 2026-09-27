import { Alert, Platform } from 'react-native';

/**
 * Asks before doing something. Alert does nothing in the web build (where the end-to-end
 * tests run), so there the browser's own dialog asks instead.
 */
export function confirm(options: {
  title: string;
  message?: string;
  confirm: string;
  cancel: string;
  /** Shown in red where the platform can. */
  destructive?: boolean;
  onConfirm: () => void;
}) {
  if (Platform.OS === 'web') {
    if (window.confirm([options.title, options.message].filter(Boolean).join('\n\n'))) options.onConfirm();
    return;
  }
  Alert.alert(options.title, options.message, [
    { text: options.cancel, style: 'cancel' },
    { text: options.confirm, style: options.destructive ? 'destructive' : 'default', onPress: options.onConfirm },
  ]);
}

/** A short message, the same way on every platform. */
export function notify(message: string) {
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert(message);
}
