import type { CritterArt } from '@gozali/critter-art';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Critter } from '@/features/critter/Critter';
import { colors, radii } from '@/theme/tokens';

const SIZE = 220;
const PHOTO = { width: 120, height: 160 };

/**
 * The critter eating the photo that was just sent (spec section 4: "an eating animation with the
 * photo that was taken"): the photo flies up and shrinks into its mouth, and the critter lights up.
 */
export function EatingMoment({ art, photoUri, label }: { art: CritterArt; photoUri: string | null; label: string }) {
  const progress = useSharedValue(0);
  const [distance, setDistance] = useState(0);
  const [eaten, setEaten] = useState(photoUri === null);

  useEffect(() => {
    if (!photoUri || distance === 0) return;
    progress.value = withDelay(250, withTiming(1, { duration: 750, easing: Easing.in(Easing.cubic) }));
    const timer = setTimeout(() => setEaten(true), 1000);
    return () => clearTimeout(timer);
  }, [photoUri, distance, progress]);

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

  return (
    <View style={styles.stage} onLayout={onLayout}>
      <Critter art={eaten ? { ...art, mood: 1 } : { ...art, mood: 0 }} size={SIZE} label={label} />
      {photoUri && !eaten && (
        <Animated.View style={[styles.photo, photoStyle]} pointerEvents="none">
          <Image source={{ uri: photoUri }} style={styles.image} contentFit="cover" />
        </Animated.View>
      )}
    </View>
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
});
