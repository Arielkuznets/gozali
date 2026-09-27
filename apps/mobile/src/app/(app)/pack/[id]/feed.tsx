import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/features/auth/AuthProvider';
import { Critter } from '@/features/critter/Critter';
import { critterArt } from '@/features/critter/art';
import { useSendFeed } from '@/features/feeds/api';
import { compressPhoto } from '@/features/feeds/send';
import { usePack } from '@/features/packs/api';
import { categoryInfo } from '@/features/packs/constants';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const CAPTION_MAX = 80;

type Shot = { uri: string; width: number; capturedAt: string };

/** Take a live photo, add a caption and send it (spec section 6). No gallery uploads. */
export default function FeedScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string; extra?: string; focus?: string }>();
  const packId = params.id;
  const extra = params.extra === '1';
  const focusMinutes = params.focus ? Number(params.focus) : null;
  const { session } = useAuth();
  const { data: pack } = usePack(packId);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [caption, setCaption] = useState('');
  const [result, setResult] = useState<'sent' | 'queued' | null>(null);
  const send = useSendFeed();

  // After a successful feed, the critter eats for a moment and the screen closes by itself.
  useEffect(() => {
    if (result !== 'sent') return;
    const timer = setTimeout(() => router.back(), 2200);
    return () => clearTimeout(timer);
  }, [result]);

  const capture = async () => {
    if (!camera.current || !ready) return;
    const capturedAt = new Date().toISOString();
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const photo = await camera.current.takePictureAsync({ quality: 0.9 });
    if (photo) setShot({ uri: photo.uri, width: photo.width, capturedAt });
  };

  const submit = async () => {
    if (!shot || !session) return;
    try {
      const photoUri = await compressPhoto(shot.uri, shot.width);
      const outcome = await send.mutateAsync({
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        packId,
        userId: session.user.id,
        photoUri,
        caption: caption.trim() || null,
        capturedAt: shot.capturedAt,
        focusMinutes,
        extra,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(outcome);
    } catch {
      Alert.alert(t('feed.failed'));
    }
  };

  if (result && pack?.critters) {
    const critter = pack.critters;
    const name = critter.name ?? t(`packs.species.${critter.species}`);
    const art = { ...critterArt(critter, { category: pack.category, now: new Date() }), mood: 1, sleeping: false };
    return (
      <SafeAreaView style={styles.doneScreen}>
        <View style={styles.done}>
          <Critter art={art} size={220} label={t('feed.ateLabel', { name })} />
          <AppText variant="heading" style={styles.centerText}>
            {result === 'sent' ? t('feed.sent', { name }) : t('feed.queuedTitle')}
          </AppText>
          {result === 'queued' && <AppText style={[styles.centerText, styles.muted]}>{t('feed.queuedBody')}</AppText>}
        </View>
        {result === 'queued' && <Button label={t('feed.close')} onPress={() => router.back()} />}
      </SafeAreaView>
    );
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.dark}>
        <ActivityIndicator color={colors.onAccent} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.doneScreen}>
        <View style={styles.done}>
          <AppText variant="heading" style={styles.centerText}>
            {t('feed.permissionTitle')}
          </AppText>
          <AppText style={[styles.centerText, styles.muted]}>{t('feed.permissionBody')}</AppText>
        </View>
        {permission.canAskAgain ? (
          <Button label={t('feed.allowCamera')} onPress={() => void requestPermission()} />
        ) : (
          <Button label={t('feed.openSettings')} onPress={() => void Linking.openSettings()} />
        )}
        <Button label={t('feed.close')} variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const title = extra ? t('feed.extraTitle') : t('feed.title', { name: pack?.critters?.name ?? pack?.name ?? '' });

  if (shot) {
    return (
      <SafeAreaView style={styles.dark}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.frame}>
            <Image source={{ uri: shot.uri }} style={styles.fill} contentFit="cover" accessibilityLabel={t('feed.photoLabel')} />
            {focusMinutes !== null && <FocusChip minutes={focusMinutes} emoji={pack ? categoryInfo(pack.category).emoji : '⏱'} />}
          </View>
          <View style={styles.sheet}>
            <TextField
              value={caption}
              onChangeText={setCaption}
              maxLength={CAPTION_MAX}
              placeholder={t('feed.captionPlaceholder')}
              accessibilityLabel={t('feed.captionLabel')}
            />
            <View style={styles.row}>
              <View style={styles.fill}>
                <Button label={t('feed.retake')} variant="secondary" onPress={() => setShot(null)} disabled={send.isPending} />
              </View>
              <View style={styles.fill}>
                <Button label={t('feed.send')} onPress={() => void submit()} loading={send.isPending} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.dark}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('feed.close')} onPress={() => router.back()} hitSlop={12}>
          <AppText style={styles.light}>✕</AppText>
        </Pressable>
        <AppText style={[styles.light, styles.title]} numberOfLines={1}>
          {title}
        </AppText>
        <View style={styles.iconSpace} />
      </View>
      <View style={styles.frame}>
        <CameraView ref={camera} style={styles.fill} facing={facing} onCameraReady={() => setReady(true)} />
        {focusMinutes !== null && <FocusChip minutes={focusMinutes} emoji={pack ? categoryInfo(pack.category).emoji : '⏱'} />}
      </View>
      <View style={styles.controls}>
        <View style={styles.iconSpace} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.capture')}
          onPress={() => void capture()}
          disabled={!ready}
          style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed, !ready && styles.disabled]}>
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.flip')}
          onPress={() => setFacing((side) => (side === 'back' ? 'front' : 'back'))}
          hitSlop={12}
          style={styles.iconSpace}>
          <AppText style={[styles.light, styles.flip]}>⟲</AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function FocusChip({ minutes, emoji }: { minutes: number; emoji: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.chip}>
      <AppText style={styles.chipText}>{t('feed.focusChip', { minutes, emoji })}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dark: { flex: 1, backgroundColor: '#1E1916', justifyContent: 'center' },
  doneScreen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.sm },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
  light: { color: colors.onAccent },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyMedium },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  frame: { flex: 1, marginHorizontal: spacing.sm, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: '#000' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  iconSpace: { width: 44, alignItems: 'center' },
  flip: { fontSize: 30 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.onAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.onAccent },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  disabled: { opacity: 0.4 },
  sheet: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.background, borderRadius: radii.lg, margin: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  chipText: { fontFamily: fonts.bodyMedium },
});
