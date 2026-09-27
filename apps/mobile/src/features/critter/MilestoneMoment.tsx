import type { CritterArt } from '@gozali/critter-art';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Critter } from '@/features/critter/Critter';
import type { Milestone } from '@/features/critter/milestones';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme/tokens';

const SIZE = 200;

type Props = {
  milestone: Milestone;
  /** The critter as it is now. */
  art: CritterArt;
  name: string;
  onClose: () => void;
};

/**
 * A short celebration the first time a member sees the critter hatch, grow into a new stage or
 * come back (spec section 4): the egg shakes and bursts, the critter grows, or it walks back in.
 */
export function MilestoneMoment({ milestone, art, name, onClose }: Props) {
  const { t } = useTranslation();
  const shake = useSharedValue(0);
  const eggGone = useSharedValue(milestone.kind === 'hatched' ? 0 : 1);
  const pop = useSharedValue(0);
  const text = useSharedValue(0);

  useEffect(() => {
    const reveal = milestone.kind === 'hatched' ? 1000 : 250;
    if (milestone.kind === 'hatched') {
      shake.value = withRepeat(withSequence(withTiming(-1, { duration: 80 }), withTiming(1, { duration: 80 })), 5, true);
      eggGone.value = withDelay(850, withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }));
    }
    pop.value = withDelay(reveal, withSpring(1, { damping: 7, stiffness: 140 }));
    text.value = withDelay(reveal + 350, withTiming(1, { duration: 300 }));
    const buzz = setTimeout(() => {
      haptics.success();
    }, reveal);
    return () => clearTimeout(buzz);
  }, [milestone.kind, shake, eggGone, pop, text]);

  const eggStyle = useAnimatedStyle(() => ({
    opacity: 1 - eggGone.value,
    transform: [{ rotate: `${shake.value * 8}deg` }, { scale: 1 + eggGone.value * 0.35 }],
  }));
  const critterStyle = useAnimatedStyle(() => {
    const p = pop.value;
    if (milestone.kind === 'returned') return { opacity: Math.min(1, p * 1.5), transform: [{ translateX: (1 - p) * 180 }] };
    const from = milestone.kind === 'hatched' ? 0.3 : 0.75;
    return { opacity: Math.min(1, p * 2), transform: [{ scale: from + (1 - from) * p }] };
  });
  const textStyle = useAnimatedStyle(() => ({ opacity: text.value, transform: [{ translateY: (1 - text.value) * 12 }] }));

  const title =
    milestone.kind === 'hatched'
      ? t('moments.hatchedTitle', { name })
      : milestone.kind === 'returned'
        ? t('moments.returnedTitle', { name })
        : t('moments.evolvedTitle', { name, stage: t(`critter.stages.${milestone.to}`) });
  const body = t(`moments.${milestone.kind}Body`);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.stage}>
            {milestone.kind === 'hatched' && (
              <Animated.View style={[styles.layer, eggStyle]} pointerEvents="none">
                <Critter art={{ ...art, stage: 'egg', look: 'egg', cracking: true }} size={SIZE} label="" animated={false} />
              </Animated.View>
            )}
            <Animated.View style={[styles.layer, critterStyle]}>
              <Critter art={{ ...art, sleeping: false, mood: 1 }} size={SIZE} label={title} />
            </Animated.View>
          </View>
          <Animated.View style={[styles.text, textStyle]}>
            <AppText variant="heading" style={styles.center} accessibilityRole="header">
              {title}
            </AppText>
            <AppText style={[styles.center, styles.muted]}>{body}</AppText>
          </Animated.View>
          <Button label={t('moments.close')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(59, 47, 42, 0.45)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  stage: { height: SIZE, alignItems: 'center', justifyContent: 'center' },
  layer: { position: 'absolute' },
  text: { gap: spacing.sm },
  center: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
});
