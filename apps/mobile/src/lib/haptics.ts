import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Small vibrations that answer the user's actions (spec section 10: every action gets a little
 * feedback). Quiet on the web and wherever the phone can't vibrate.
 */
export const haptics = {
  /** A tap that picks something: a reaction, an outfit. */
  tap: () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
  },
  /** A light bump: petting, taking the photo. */
  bump: (style: 'light' | 'medium' = 'light') => {
    if (Platform.OS === 'web') return;
    const impact = style === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium;
    void Haptics.impactAsync(impact).catch(() => undefined);
  },
  /** Something worked: fed, bought, joined, a milestone. */
  success: () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
};
