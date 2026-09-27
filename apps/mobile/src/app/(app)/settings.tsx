import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { deleteAccount } from '@/features/auth/signIn';
import { NOTIFICATION_TYPES, useProfile, useUpdateProfile, type NotificationType } from '@/features/profile/useProfile';
import { isBlockedText } from '@/lib/errors';
import { requireSupabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';
import { colors, radii, spacing } from '@/theme/tokens';

const REMINDER_TIMES = ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'] as const;

/** App settings (spec section 9): reminder time, notifications by type, blocked people. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const profile = useProfile();
  const update = useUpdateProfile();
  const blocked = useBlocked();

  if (!profile.data) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }
  const prefs = profile.data.notification_prefs ?? {};
  const reminder = profile.data.reminder_time.slice(0, 5);
  const save = (settings: Parameters<typeof update.mutate>[0]) =>
    update.mutate(settings, {
      onError: (error) => Alert.alert(isBlockedText(error) ? t('errors.textNotAllowed') : t('errors.saveFailed')),
    });
  const toggle = (type: NotificationType, on: boolean) => save({ notification_prefs: { ...prefs, [type]: on } });

  const onDelete = () => {
    Alert.alert(t('settings.app.deleteTitle'), t('settings.app.deleteBody'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.app.deleteConfirm'),
        style: 'destructive',
        onPress: () => void deleteAccount().catch(() => Alert.alert(t('settings.app.deleteFailed'))),
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack('/me')} hitSlop={12}>
          <AppText variant="caption">{t('me.back')}</AppText>
        </Pressable>
        <AppText variant="heading">{t('settings.app.title')}</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.section}>
          <AppText variant="caption">{t('settings.app.reminder')}</AppText>
          <View style={styles.row}>
            {REMINDER_TIMES.map((time) => (
              <Choice key={time} label={time} selected={reminder === time} onPress={() => save({ reminder_time: time })}>
                <AppText>{time}</AppText>
              </Choice>
            ))}
          </View>
          <AppText variant="caption">{t('settings.app.reminderHint')}</AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="caption">{t('settings.app.notifications')}</AppText>
          <View style={styles.list}>
            {NOTIFICATION_TYPES.map((type) => (
              <View key={type} style={styles.listRow}>
                <AppText style={styles.fill}>{t(`settings.app.types.${type}`)}</AppText>
                <Switch
                  accessibilityLabel={t(`settings.app.types.${type}`)}
                  value={prefs[type] !== false}
                  onValueChange={(on) => toggle(type, on)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor={colors.surface}
                />
              </View>
            ))}
          </View>
          <AppText variant="caption">{t('settings.app.quietHours')}</AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="caption">{t('settings.app.blocked')}</AppText>
          {blocked.data?.length === 0 && <AppText style={styles.muted}>{t('settings.app.noBlocked')}</AppText>}
          {blocked.data && blocked.data.length > 0 && (
            <View style={styles.list}>
              {blocked.data.map((person) => (
                <View key={person.id} style={styles.listRow}>
                  <AppText style={styles.fill}>{person.name ?? '…'}</AppText>
                  <Pressable accessibilityRole="button" onPress={() => blocked.unblock(person.id)} hitSlop={8}>
                    <AppText variant="caption" style={styles.link}>
                      {t('settings.app.unblock')}
                    </AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <AppText variant="caption">{t('settings.app.widgets')}</AppText>
          <AppText style={styles.muted}>{t('widgets.howTo')}</AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="caption">{t('settings.app.language')}</AppText>
          <View style={styles.row}>
            <Choice label={t('settings.app.english')} selected onPress={() => undefined}>
              <AppText>{t('settings.app.english')}</AppText>
            </Choice>
          </View>
        </View>

        <View style={styles.section}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://gozali.app/privacy')}>
            <AppText style={styles.link}>{t('settings.app.privacy')}</AppText>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://gozali.app/terms')}>
            <AppText style={styles.link}>{t('settings.app.terms')}</AppText>
          </Pressable>
          <AppText variant="caption">{t('settings.app.contact')}</AppText>
        </View>

        <Pressable accessibilityRole="button" onPress={onDelete} hitSlop={8}>
          <AppText style={styles.danger}>{t('settings.app.deleteAccount')}</AppText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/** People the user blocked, with their names where they still share a pack. */
function useBlocked() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const query = useQuery({
    queryKey: ['blocks', userId],
    enabled: userId !== undefined,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('blocks')
        .select('blocked_id, profiles!blocks_blocked_id_fkey ( display_name )')
        .eq('blocker_id', userId ?? '');
      if (error) throw error;
      return data.map((row) => ({ id: row.blocked_id, name: row.profiles?.display_name ?? null }));
    },
  });
  const remove = useMutation({
    mutationFn: async (blockedId: string) => {
      const { error } = await requireSupabase().from('blocks').delete().eq('blocker_id', userId ?? '').eq('blocked_id', blockedId);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['blocks'] });
      void queryClient.invalidateQueries({ queryKey: ['feeds'] });
    },
  });
  return { ...query, unblock: (id: string) => remove.mutate(id) };
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  headerSpacer: { width: 32 },
  body: { gap: spacing.lg, paddingBottom: spacing.xl },
  section: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fill: { flex: 1 },
  muted: { color: colors.inkMuted },
  link: { color: colors.accent },
  danger: { color: colors.danger, paddingVertical: spacing.sm },
});
