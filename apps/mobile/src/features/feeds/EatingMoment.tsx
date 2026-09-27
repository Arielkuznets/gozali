import type { CritterArt } from '@gozali/critter-art';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Critter } from '@/features/critter/Critter';
import { colors, radii } from '@/theme/tokens';

const SIZE = 220;
const PHOTO = { width: 120, height: 160 };
// Where the hearts rise from, left to right, and how long each waits.
const HEARTS = [
  { x: -52, delay: 0 },
  { x: 8, delay: 120 },
  { x: 60, delay: 240 },
] as const;

/**
 * The critter eating the photo that was just sent (spec section 4: "an eating animation with the
 * photo that was taken"): the photo flies up and shrinks into its mouth, and the critter lights up.
 */
export function EatingMoment({ art, photoUri, label }: { art: CritterArt; photoUri: string | null; label: string }) {
  const progress = useSharedValue(0);
  const chomp = useSharedValue(0);
  const hearts = useSharedValue(0);
  const [distance, setDistance] = useState(0);
  const [eaten, setEaten] = useState(photoUri === null);

  useEffect(() => {
    if (!photoUri || distance === 0) return;
    progress.value = withDelay(250, withTiming(1, { duration: 750, easing: Easing.in(Easing.cubic) }));
    const timer = setTimeout(() => {
      setEaten(true);
      // A happy little jump and a few hearts once the photo is in.
      chomp.value = withSequence(withTiming(1, { duration: 110 }), withSpring(0, { damping: 5, stiffness: 170 }));
      hearts.value = withTiming(1, { duration: 1300 });
    }, 1000);
    return () => clearTimeout(timer);
  }, [photoUri, distance, progress, chomp, hearts]);

  // The photo starts below the critter and ends at its mouth, about 60% down the drawing.
  const onLayout = (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    const mouth = (height - SIZE) / 2 + SIZE * 0.62;
    const start = height - PHOTO.height / 2;
    setDistance(start - mouth);
  };

  const photoStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, progress.value - 0.7) / 0.3,
    transform: [
      { translateY: -progress.value * distance },
      { scale: 1 - progress.value * 0.9 },
      { rotate: `${progress.value * 14}deg` },
    ],
  }));

  const critterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -chomp.value * 14 }, { scale: 1 + chomp.value * 0.06 }],
  }));

  return (
    <View style={styles.stage} onLayout={onLayout}>
      <Animated.View style={critterStyle}>
        <Critter art={eaten ? { ...art, mood: 1 } : { ...art, mood: 0 }} size={SIZE} label={label} />
      </Animated.View>
      {photoUri && eaten && HEARTS.map((heart) => <Heart key={heart.x} progress={hearts} {...heart} />)}
      {photoUri && !eaten && (
        <Animated.View style={[styles.photo, photoStyle]} pointerEvents="none">
          <Image source={{ uri: photoUri }} style={styles.image} contentFit="cover" />
        </Animated.View>
      )}
    </View>
  );
}

/** One heart floating up from the critter and fading, a little after the one before it. */
function Heart({ progress, x, delay }: { progress: SharedValue<number>; x: number; delay: number }) {
  const style = useAnimatedStyle(() => {
    const own = Math.min(1, Math.max(0, (progress.value * 1300 - delay) / 900));
    return {
      opacity: own < 0.15 ? own / 0.15 : 1 - (own - 0.15) / 0.85,
      transform: [{ translateX: x }, { translateY: -own * 70 }, { scale: 0.6 + own * 0.5 }],
    };
  });
  return (
    <Animated.View style={[styles.heart, style]} pointerEvents="none">
      <AppText style={styles.heartText}>❤️</AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  photo: {
    position: 'absolute',
    bottom: 0,
    width: PHOTO.width,
    height: PHOTO.height,
    borderRadius: radii.md,
    borderWidth: 4,
    borderColor: colors.surface,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
  heart: { position: 'absolute', top: '32%' },
  heartText: { fontSize: 26, lineHeight: 32 },
});
