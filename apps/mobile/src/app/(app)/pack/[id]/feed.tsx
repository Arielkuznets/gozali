import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
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
import { PackMissingScreen } from '@/components/ScreenStates';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/features/auth/AuthProvider';
import { critterArt } from '@/features/critter/art';
import { EatingMoment } from '@/features/feeds/EatingMoment';
import { pauseToday, useDayStatus } from '@/features/days/api';
import { useSendFeed } from '@/features/feeds/api';
import { compressPhoto, feedErrorKey, isFinalRejection } from '@/features/feeds/send';
import { clearFocusSession } from '@/features/focus/session';
import { usePack } from '@/features/packs/api';
import { categoryInfo } from '@/features/packs/constants';
import { confirm, notify } from '@/lib/confirm';
import { isBlockedText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { askBeforeLinks, goBack, useOpenPack } from '@/lib/navigation';
import { serverNow } from '@/lib/serverClock';
import { useNow } from '@/lib/useNow';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const CAPTION_MAX = 80;
// Right after the camera reports ready, or after switching cameras, the first frame may not be
// there yet; a few quick retries cover that before the tap counts as failed.
const CAPTURE_TRIES = 8;
const CAPTURE_RETRY_MS = 250;
const CLOSE_AFTER_MS = 1500;

type Shot = { uri: string; width: number; capturedAt: string };

/** Take a live photo, add a caption and send it (spec section 6). No gallery uploads. */
export default function FeedScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string; extra?: string; focus?: string }>();
  const packId = params.id;
  // A link to this pack reaches the camera that is open and clears these on its route. What the
  // photo is for doesn't change with that.
  const [{ extra, focusMinutes }] = useState(() => ({
    extra: params.extra === '1',
    focusMinutes: params.focus && /^[0-9]{1,3}$/.test(params.focus) ? Number(params.focus) : null,
  }));
  const { session } = useAuth();
  const { data: pack, isLoading: packLoading, refetch: refetchPack } = usePack(packId);
  const [permission, requestPermission, readPermission] = useCameraPermissions();
  // A no stays on screen until the next opening, also where the system could still ask: Android
  // asks a second time, and a browser's prompt can be dismissed.
  const [answered, setAnswered] = useState(false);
  const toAsk = permission !== null && !permission.granted && permission.canAskAgain && !answered;
  // A screen opened over this one (a tapped notification, a link) leaves it mounted. Expo asks to
  // unmount the camera then, or it runs on under that screen; its active prop is iOS only.
  const focused = useIsFocused();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [ready, setReady] = useState(false);
  // The camera says when it can't start: another app holds it, or there is no camera that works.
  const [cameraFailed, setCameraFailed] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  // The camera is gone under another screen and while a photo is shown. The one that comes back, on
  // Retake too, starts over and has to report ready again.
  if ((!focused || shot) && (ready || cameraFailed)) {
    setReady(false);
    setCameraFailed(false);
  }
  const [caption, setCaption] = useState('');
  const [result, setResult] = useState<'sent' | 'queued' | null>(null);
  // Set from the tap on Send, so a second tap while the photo is compressed doesn't send it twice.
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const send = useSendFeed();
  const dayStatus = useDayStatus(packId);
  const now = useNow(60_000);

  // A widget or a notification can link here during a pause, when no photo counts. The pack says
  // why. A photo already taken stays: it was taken before the pause reached this screen. The link at
  // the end of a focus session ends it here, as no photo will. The pack waits for that: it reads the
  // session as it comes to the front, to offer Focus.
  const paused = pauseToday(dayStatus.data, pack, session?.user.id, now) !== null && !shot && !result;
  const openPack = useOpenPack();
  useFocusEffect(
    useCallback(() => {
      if (!paused) return;
      const ended = focusMinutes !== null ? clearFocusSession(packId).catch(() => undefined) : Promise.resolve();
      void ended.then(() => openPack(packId));
    }, [paused, packId, focusMinutes, openPack]),
  );

  // The tap on Feed gives the system alert its context and the purpose string its reason, so no
  // screen of ours comes first. A link to a pack that is gone has no use for the camera, so a pack
  // the phone doesn't hold waits for its read. Offline that read fails after its retries, and the
  // alert comes then: the camera still works.
  const askNow = toAsk && pack !== null && !packLoading && !paused;
  useEffect(() => {
    if (askNow) void requestPermission().finally(() => setAnswered(true));
  }, [askNow, requestPermission]);

  // Those retries take minutes on a dead connection, on a screen that has no swipe or back on an
  // iPhone. A good connection never sees the way out.
  const waitingForPack = toAsk && packLoading;
  const [closable, setClosable] = useState(false);
  useEffect(() => {
    if (!waitingForPack) return;
    const timer = setTimeout(() => setClosable(true), CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waitingForPack]);

  // On Android the app keeps running through a yes in the phone's settings and nothing tells it, so
  // the refused screen reads the answer again on the way back. An alert brings its own answer.
  const refused = permission !== null && !permission.granted && !toAsk;
  useEffect(() => {
    if (!refused) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPermission();
    });
    return () => subscription.remove();
  }, [refused, readPermission]);

  // After a successful feed, the critter eats for a moment and the screen closes by itself. Under
  // another screen it waits to be back in front, or going back would close that screen instead.
  useEffect(() => {
    if (result !== 'sent' || !focused) return;
    const timer = setTimeout(() => goBack(`/pack/${packId}`), 2800);
    return () => clearTimeout(timer);
  }, [result, packId, focused]);

  // A live photo can't be taken again once the moment has passed, so whatever else would close the
  // camera with one waiting asks first: a widget's link to the pack under it, or the Android back
  // key. The camera's own ways out come only without a photo, or once it is sent. While it goes
  // out, or with its pack gone, there is nothing to lose.
  const navigation = useNavigation();
  const holding = shot !== null && result === null && !busy && pack !== null;
  useEffect(() => {
    if (!holding) return;
    const stopLinks = askBeforeLinks(navigation);
    const stopAsking = navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      confirm({
        title: t('feed.discardTitle'),
        message: t('feed.discardBody'),
        confirm: t('feed.discard'),
        cancel: t('feed.keep'),
        destructive: true,
        onConfirm: () => {
          stopLinks();
          stopAsking();
          navigation.dispatch(event.data.action);
        },
      });
    });
    return () => {
      stopLinks();
      stopAsking();
    };
  }, [holding, navigation, t]);

  const capture = async () => {
    if (!camera.current || !ready) return;
    // The server checks this against its own clock when the feed comes in late (offline).
    const capturedAt = serverNow().toISOString();
    haptics.bump('medium');
    for (let attempt = 1; attempt <= CAPTURE_TRIES; attempt++) {
      // The screen may have closed while waiting.
      if (!camera.current) return;
      try {
        const photo = await camera.current.takePictureAsync({ quality: 0.9 });
        if (photo) setShot({ uri: photo.uri, width: photo.width, capturedAt });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_MS));
      }
    }
    notify(t('feed.captureFailed'));
  };

  const submit = async () => {
    if (!shot || !session || sending.current) return;
    sending.current = true;
    setBusy(true);
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
      haptics.success();
      // The photo that ends the pack's focus session also ends it, whichever way the camera was opened.
      if (focusMinutes !== null) await clearFocusSession(packId);
      setResult(outcome);
    } catch (error) {
      // Removed from the pack while the camera was open, the upload is refused before the server
      // could say why. With the pack gone the screen says so, instead of "try again".
      if (isFinalRejection(error) && !isBlockedText(error) && (await refetchPack()).data === null) return;
      notify(t(feedErrorKey(error)));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  if (result) {
    // Opened from a link while offline, the pack may not be loaded: then no animation. A pet that ran
    // away isn't there to eat the photo, which counts toward bringing it back.
    const critter = pack?.critters;
    const name = critter ? (critter.name ?? t(`packs.species.${critter.species}`)) : null;
    const away = critter?.status === 'ran_away';
    return (
      <SafeAreaView style={styles.doneScreen}>
        {pack && critter && name && !away ? (
          <EatingMoment
            art={{ ...critterArt(critter, { category: pack.category, now: serverNow() }), mood: 1, sleeping: false }}
            photoUri={shot?.uri ?? null}
            label={t('feed.ateLabel', { name })}
          />
        ) : (
          <View style={styles.done} />
        )}
        <View style={styles.doneText}>
          <AppText variant="heading" style={styles.centerText}>
            {result === 'queued' ? t('feed.queuedTitle') : name && !away ? t('feed.sent', { name }) : t('feed.sentPlain')}
          </AppText>
          {result === 'queued' && <AppText style={[styles.centerText, styles.muted]}>{t('feed.queuedBody')}</AppText>}
          {result === 'sent' && away && <AppText style={[styles.centerText, styles.muted]}>{t('critter.ranAwayBody', { name })}</AppText>}
        </View>
        {result === 'queued' && <Button label={t('feed.close')} onPress={() => goBack(`/pack/${packId}`)} />}
      </SafeAreaView>
    );
  }

  // A link from a pack the user isn't in any more (an old notification, a widget, another
  // account's link) has nothing to feed. Offline a pack the phone doesn't hold never loads, and the
  // camera still works so the feed can wait in the queue.
  if (pack === null) return <PackMissingScreen />;

  if (!permission || toAsk || paused) {
    return (
      <SafeAreaView style={styles.dark}>
        {waitingForPack && closable && (
          <View style={styles.topBar}>
            <CloseCamera packId={packId} />
          </View>
        )}
        <ActivityIndicator style={styles.fill} color={colors.onDark} />
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
        <Button label={t('feed.openSettings')} onPress={() => void Linking.openSettings()} />
        <Button label={t('feed.close')} variant="secondary" onPress={() => goBack(`/pack/${packId}`)} />
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
                <Button label={t('feed.retake')} variant="secondary" onPress={() => setShot(null)} disabled={busy} />
              </View>
              <View style={styles.fill}>
                <Button label={t('feed.send')} onPress={() => void submit()} loading={busy} />
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
        <CloseCamera packId={packId} />
        <AppText style={[styles.light, styles.title]} numberOfLines={1}>
          {title}
        </AppText>
        <View style={styles.iconSpace} />
      </View>
      <View style={styles.frame}>
        {focused && (
          <CameraView
            ref={camera}
            style={styles.fill}
            facing={facing}
            onCameraReady={() => setReady(true)}
            onMountError={() => setCameraFailed(true)}
          />
        )}
        {cameraFailed && (
          <View style={[StyleSheet.absoluteFill, styles.frameNotice]}>
            <AppText style={[styles.light, styles.centerText]}>{t('feed.cameraFailed')}</AppText>
          </View>
        )}
        {focusMinutes !== null && <FocusChip minutes={focusMinutes} emoji={pack ? categoryInfo(pack.category).emoji : '⏱'} />}
      </View>
      <View style={styles.controls}>
        <View style={styles.iconSpace} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.capture')}
          accessibilityState={{ disabled: !ready }}
          onPress={() => void capture()}
          disabled={!ready}
          style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed, !ready && styles.disabled]}>
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.flip')}
          onPress={() => {
            // The other camera is another try.
            setCameraFailed(false);
            setFacing((side) => (side === 'back' ? 'front' : 'back'));
          }}
          hitSlop={12}
          style={styles.iconSpace}>
          <AppText style={[styles.light, styles.flip]}>⟲</AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function CloseCamera({ packId }: { packId: string }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('feed.close')} onPress={() => goBack(`/pack/${packId}`)} hitSlop={12}>
      <AppText style={styles.light}>✕</AppText>
    </Pressable>
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
  doneText: { alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xl },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
  light: { color: colors.onDark },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyMedium },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  frame: { flex: 1, marginHorizontal: spacing.sm, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: '#000' },
  frameNotice: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  iconSpace: { width: 44, alignItems: 'center' },
  flip: { fontSize: 30, lineHeight: 36 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.onDark },
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
