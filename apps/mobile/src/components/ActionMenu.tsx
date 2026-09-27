import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export type MenuAction = { label: string; onPress: () => void; destructive?: boolean };
export type Menu = { title: string; actions: MenuAction[] };

type Props = {
  menu: Menu | null;
  cancel: string;
  onClose: () => void;
};

/**
 * A list of choices that slides up from the bottom. Android's Alert shows three buttons at most
 * and the web build shows none, so menus with more choices use this on every platform.
 */
export function ActionMenu({ menu, cancel, onClose }: Props) {
  const insets = useSafeAreaInsets();
  // The last menu stays drawn while the sheet slides away.
  const [shown, setShown] = useState(menu);
  if (menu && menu !== shown) setShown(menu);
  // iOS drops an alert or a picker opened while the menu is still closing, so there the choice
  // runs once the menu is gone.
  const chosen = useRef<MenuAction | null>(null);
  const run = () => {
    const action = chosen.current;
    chosen.current = null;
    action?.onPress();
  };
  const choose = (action: MenuAction) => {
    chosen.current = action;
    onClose();
    if (Platform.OS !== 'ios') run();
  };

  return (
    <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={onClose} onDismiss={run} statusBarTranslucent>
      <Pressable accessibilityLabel={cancel} style={styles.backdrop} onPress={onClose} />
      {/* The dim background fades in; the sheet slides up over it. */}
      <Animated.View
        entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}
        style={[styles.sheet, { paddingBottom: spacing.md + insets.bottom }]}
        accessibilityRole="menu">
        {shown && (
          <AppText variant="caption" style={styles.title} numberOfLines={2}>
            {shown.title}
          </AppText>
        )}
        {shown?.actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="menuitem"
            onPress={() => choose(action)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <AppText style={[styles.label, action.destructive && styles.danger]}>{action.label}</AppText>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.row, styles.cancel, pressed && styles.pressed]}>
          <AppText style={styles.label}>{cancel}</AppText>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(59, 47, 42, 0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  title: { textAlign: 'center', paddingBottom: spacing.sm },
  row: { minHeight: 52, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.background },
  cancel: { marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, borderRadius: 0 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 17 },
  danger: { color: colors.danger },
});
