import { renderCritter, type CritterArt } from '@gozali/critter-art';
import * as Haptics from 'expo-haptics';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { colors, radii, spacing } from '@/theme/tokens';

type Props = {
  art: CritterArt;
  size: number;
  /** Screen reader description, for example "Pixel is hungry, health 45". */
  label: string;
  /** Idle breathing, blinking and yawning; off for small, static uses. */
  animated?: boolean;
  /** Lines to say when petted. Without them the critter can't be petted. */
  lines?: readonly string[];
  petHint?: string;
};

const BLINK_MS = 140;
const YAWN_MS = 1300;
const YAWN_FADE_MS = 150;
// Seconds between yawns, the first number plus up to the second. Mochi and Bun are the sleepy ones.
const YAWN_EVERY: Record<CritterArt['species'], [number, number]> = {
  mochi: [12, 12],
  kit: [30, 30],
  axo: [30, 30],
  ribbit: [30, 30],
  hoot: [30, 30],
  bun: [16, 16],
};
const LINE_MS = 2600;

/**
 * The one component every screen uses for the critter (spec section 10): it draws the
 * critter from its state, so the final illustrated character replaces only this file.
 */
export function Critter({ art, size, label, animated = true, lines, petHint }: Props) {
  const [line, setLine] = useState<string | null>(null);
  const lineTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [gaze, setGaze] = useState<{ x: number; y: number } | undefined>(undefined);
  const gazeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const box = useRef<View>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const breath = useSharedValue(0);
  const jump = useSharedValue(0);
  // Blinks and yawns are drawings of their own laid over the critter and shown for a moment on
  // the animation thread, so idle animation never redraws or re-parses the SVG.
  const blink = useSharedValue(0);
  const yawn = useSharedValue(0);

  const present = art.look !== 'ran_away';
  const awake = present && art.look !== 'egg' && !art.sleeping;
  const wobbles = art.look === 'egg' && (art.cracking ?? false);
  const bounces = awake && art.look === 'thriving';

  useEffect(() => {
    if (!animated || !present) return;
    breath.value = withRepeat(
      withTiming(1, { duration: art.sleeping ? 2600 : 1700, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(breath);
  }, [animated, present, art.sleeping, breath]);

  // Blink every few seconds while awake.
  useEffect(() => {
    if (!animated || !awake) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          blink.value = withSequence(withTiming(1, { duration: 0 }), withDelay(BLINK_MS, withTiming(0, { duration: 0 })));
          schedule();
        },
        2200 + Math.random() * 3200,
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
      blink.value = 0;
    };
  }, [animated, awake, blink]);

  // Now and then a yawn.
  useEffect(() => {
    if (!animated || !awake || art.look === 'sick') return;
    const [base, spread] = YAWN_EVERY[art.species];
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          yawn.value = withSequence(
            withTiming(1, { duration: YAWN_FADE_MS }),
            withDelay(YAWN_MS - 2 * YAWN_FADE_MS, withTiming(0, { duration: YAWN_FADE_MS })),
          );
          schedule();
        },
        (base + Math.random() * spread) * 1000,
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
      yawn.value = 0;
    };
  }, [animated, awake, art.look, art.species, yawn]);

  useEffect(
    () => () => {
      clearTimeout(lineTimer.current);
      clearTimeout(gazeTimer.current);
    },
    [],
  );

  // Where the finger is, from the middle of the face, in steps of a quarter so a moving finger
  // redraws the eyes a few times rather than on every event.
  const follow = (event: GestureResponderEvent) => {
    if (!awake || !animated || !origin.current) return;
    const step = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 4) / 4;
    const x = step((event.nativeEvent.pageX - origin.current.x) / (size / 2));
    const y = step((event.nativeEvent.pageY - origin.current.y) / (size / 2));
    clearTimeout(gazeTimer.current);
    setGaze((current) => (current?.x === x && current.y === y ? current : { x, y }));
  };
  const startFollowing = (event: GestureResponderEvent) => {
    box.current?.measure((_x, _y, width, height, pageX, pageY) => {
      origin.current = { x: pageX + width / 2, y: pageY + height * 0.62 };
      follow(event);
    });
  };
  const stopFollowing = () => {
    clearTimeout(gazeTimer.current);
    gazeTimer.current = setTimeout(() => setGaze(undefined), 700);
  };

  // Ids inside the drawing are unique per critter: on the web every screen shares one page.
  const svgId = `gz${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const xml = useMemo(() => renderCritter({ ...art, gaze }, { id: svgId }), [art, gaze, svgId]);
  const blinks = animated && awake;
  const yawns = blinks && art.look !== 'sick';
  const blinkXml = useMemo(
    () => (blinks ? renderCritter({ ...art, blinking: true }, { id: `${svgId}b` }) : null),
    [art, blinks, svgId],
  );
  const yawnXml = useMemo(
    () => (yawns ? renderCritter({ ...art, yawning: true }, { id: `${svgId}y` }) : null),
    [art, yawns, svgId],
  );
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  const yawnStyle = useAnimatedStyle(() => ({ opacity: yawn.value }));

  const motion = useAnimatedStyle(() => {
    const b = breath.value;
    return {
      transform: [
        { translateY: -jump.value * size * 0.12 - (bounces ? b * size * 0.035 : 0) },
        { rotate: `${wobbles ? Math.sin(b * Math.PI * 4) * 4 : 0}deg` },
        { scaleX: art.look === 'egg' ? 1 : 1 - b * 0.012 },
        { scaleY: art.look === 'egg' ? 1 : 1 + b * 0.028 },
      ],
    };
  });

  const canPet = present && lines !== undefined && lines.length > 0;
  const onPet = () => {
    if (!canPet) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    jump.value = withSequence(withTiming(1, { duration: 150 }), withSpring(0, { damping: 6, stiffness: 180 }));
    setLine(lines[Math.floor(Math.random() * lines.length)] ?? null);
    clearTimeout(lineTimer.current);
    lineTimer.current = setTimeout(() => setLine(null), LINE_MS);
  };

  const drawing = (
    <Animated.View style={[{ width: size, height: size, transformOrigin: 'bottom' }, motion]}>
      <SvgXml xml={xml} width={size} height={size} />
      {blinkXml && (
        <Animated.View style={[StyleSheet.absoluteFill, blinkStyle]} pointerEvents="none">
          <SvgXml xml={blinkXml} width={size} height={size} />
        </Animated.View>
      )}
      {yawnXml && (
        <Animated.View style={[StyleSheet.absoluteFill, yawnStyle]} pointerEvents="none">
          <SvgXml xml={yawnXml} width={size} height={size} />
        </Animated.View>
      )}
    </Animated.View>
  );

  return (
    <View
      ref={box}
      style={[styles.wrap, { width: size }]}
      onTouchStart={startFollowing}
      onTouchMove={follow}
      onTouchEnd={stopFollowing}
      onTouchCancel={stopFollowing}>
      {line !== null && (
        <View style={[styles.bubble, { bottom: size * 0.88 }]} pointerEvents="none">
          <AppText variant="caption" style={styles.bubbleText}>
            {line}
          </AppText>
        </View>
      )}
      {canPet ? (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={petHint} onPress={onPet}>
          {drawing}
        </Pressable>
      ) : (
        <View accessible accessibilityRole="image" accessibilityLabel={label}>
          {drawing}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  bubble: {
    position: 'absolute',
    zIndex: 1,
    maxWidth: 240,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: { color: colors.ink, textAlign: 'center' },
});
