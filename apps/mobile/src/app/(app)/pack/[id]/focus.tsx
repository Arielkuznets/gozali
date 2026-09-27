import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { LoadingScreen, LoadFailedScreen, PackMissingScreen } from '@/components/ScreenStates';
import { Critter } from '@/features/critter/Critter';
import { critterArt } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { FOCUS_LENGTHS, elapsedMs, remainingMs, useFocusSession } from '@/features/focus/session';
import { usePack } from '@/features/packs/api';
import { confirm } from '@/lib/confirm';
import { allowNotifications } from '@/lib/notifications';
import { goBack } from '@/lib/navigation';
import { useNow } from '@/lib/useNow';
import { colors, fonts, spacing } from '@/theme/tokens';

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A focus timer for Study and Reading packs; a photo is still the proof at the end. */
export default function FocusScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending, isError, refetch } = usePack(id);
  const focus = useFocusSession({ title: t('focus.doneTitle'), body: t('focus.doneBody') });
  const now = useNow(1000);
  const opened = useRef(false);

  const session = focus.session?.packId === id ? focus.session : null;
  const otherSession = focus.session !== null && session === null;
  const left = session ? remainingMs(session, now.getTime()) : null;

  const takePhoto = async () => {
    const minutes = await focus.stop();
    router.replace(`/pack/${id}/feed?focus=${minutes}`);
  };

  // When the time runs out with the screen open, go straight to the camera. A session that
  // ended a while ago (the app was closed) waits for the Done button instead.
  const justEnded =
    session !== null && session.minutes !== null && elapsedMs(session, now.getTime()) - session.minutes * 60_000 < 60_000;
  useEffect(() => {
    if (left === 0 && justEnded && !opened.current) {
      opened.current = true;
      void takePhoto();
    }
  });

  if (isPending || !focus.loaded) return <LoadingScreen />;
  if (!pack && isError) return <LoadFailedScreen onRetry={() => void refetch()} />;
  if (!pack) return <PackMissingScreen />;

  const onCancel = () =>
    confirm({
      title: t('focus.cancelTitle'),
      message: t('focus.cancelBody'),
      confirm: t('focus.cancelConfirm'),
      cancel: t('focus.keepGoing'),
      destructive: true,
      onConfirm: () => void focus.stop(),
    });

  const start = async (minutes: number | null) => {
    await allowNotifications();
    await focus.start(id, minutes);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack(`/pack/${id}`)} hitSlop={12}>
          <AppText variant="caption">{t('pack.back')}</AppText>
        </Pressable>
      </View>

      <View style={styles.body}>
        {pack.critters && <FocusCritter pack={pack} />}
        {session ? (
          <>
            <AppText style={styles.clock} accessibilityRole="timer">
              {clock(left ?? elapsedMs(session, now.getTime()))}
            </AppText>
            <AppText variant="caption">
              {session.pausedAt !== null
                ? t('focus.paused')
                : session.minutes === null
                  ? t('focus.openRunning')
                  : t('focus.running', { minutes: session.minutes })}
            </AppText>
          </>
        ) : (
          <>
            <AppText variant="heading" style={styles.centerText}>
              {t('focus.title')}
            </AppText>
            <AppText style={[styles.centerText, styles.muted]}>{t('focus.body')}</AppText>
            {otherSession && <AppText variant="caption">{t('focus.otherRunning')}</AppText>}
            <View style={styles.lengths}>
              {FOCUS_LENGTHS.map((minutes) => (
                <Choice key={minutes} label={t('focus.minutes', { minutes })} selected={false} onPress={() => void start(minutes)}>
                  <AppText variant="heading">{minutes}</AppText>
                  <AppText variant="caption">{t('focus.min')}</AppText>
                </Choice>
              ))}
            </View>
            <Button label={t('focus.open')} variant="secondary" onPress={() => void start(null)} />
          </>
        )}
      </View>

      {session && (
        <View style={styles.actions}>
          <Button label={t('focus.takePhoto')} onPress={() => void takePhoto()} />
          <View style={styles.row}>
            <View style={styles.fill}>
              {session.pausedAt === null ? (
                <Button label={t('focus.pause')} variant="secondary" onPress={() => void focus.pause()} />
              ) : (
                <Button label={t('focus.resume')} variant="secondary" onPress={() => void focus.resume()} />
              )}
            </View>
            <View style={styles.fill}>
              <Button label={t('focus.cancel')} variant="secondary" onPress={onCancel} />
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}

function FocusCritter({ pack }: { pack: NonNullable<ReturnType<typeof usePack>['data']> }) {
  const critter = pack.critters!;
  const art = { ...critterArt(critter, { category: pack.category, now: new Date() }), sleeping: false };
  const text = useCritterText(critter, art);
  return <Critter art={art} size={160} label={text.label} lines={text.lines} />;
}

const styles = StyleSheet.create({
  header: { paddingVertical: spacing.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted, maxWidth: 320 },
  clock: { fontFamily: fonts.heading, fontSize: 64, lineHeight: 76, fontVariant: ['tabular-nums'] },
  lengths: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  actions: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  fill: { flex: 1 },
});
