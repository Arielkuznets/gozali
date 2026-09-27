import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { LoadingScreen, LoadFailedScreen, PackMissingScreen } from '@/components/ScreenStates';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/features/auth/AuthProvider';
import { PauseSection } from '@/features/days/PauseSection';
import {
  currentMembers,
  packErrorKey,
  useLeavePack,
  usePack,
  useRemoveMember,
  useUpdatePack,
  type Pack,
} from '@/features/packs/api';
import { PACK_NAME_MAX, REST_DAYS_MAX, type WeekStart } from '@/features/packs/constants';
import { confirm, notify } from '@/lib/confirm';
import { formatDay } from '@/lib/dates';
import { goBack } from '@/lib/navigation';
import { colors, radii, spacing } from '@/theme/tokens';

export default function PackSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending, isError, refetch } = usePack(id);

  if (isPending) return <LoadingScreen />;
  if (!pack && isError) return <LoadFailedScreen onRetry={() => void refetch()} />;
  if (!pack) return <PackMissingScreen />;
  return <SettingsForm pack={pack} />;
}

function SettingsForm({ pack }: { pack: Pack }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const members = currentMembers(pack);
  const isAdmin = members.some((member) => member.user_id === userId && member.role === 'admin');

  // Pending values are what the pack will use from next week, so they are what the form edits.
  const savedRestDays = pack.pending_rest_days_per_week ?? pack.rest_days_per_week;
  const savedWeekStart = pack.pending_week_start ?? pack.week_start;
  const [name, setName] = useState(pack.name);
  const [restDays, setRestDays] = useState(savedRestDays);
  const [weekStart, setWeekStart] = useState<WeekStart>(savedWeekStart);
  const changed = name.trim() !== pack.name || restDays !== savedRestDays || weekStart !== savedWeekStart;

  const updatePack = useUpdatePack(pack.id);
  const removeMember = useRemoveMember(pack.id);
  const leavePack = useLeavePack();

  const onSave = () => {
    updatePack.mutate(
      { name: name.trim(), restDays, weekStart },
      { onError: (error) => notify(t(packErrorKey(error))) },
    );
  };

  const onRemove = (memberId: string, memberName: string) => {
    confirm({
      title: t('settings.removeConfirm', { name: memberName }),
      confirm: t('settings.remove'),
      cancel: t('settings.cancel'),
      destructive: true,
      onConfirm: () => removeMember.mutate(memberId, { onError: (error) => notify(t(packErrorKey(error))) }),
    });
  };

  const onLeave = () => {
    confirm({
      title: t('settings.leaveConfirm'),
      confirm: t('settings.confirm'),
      cancel: t('settings.cancel'),
      destructive: true,
      onConfirm: () =>
        leavePack.mutate(pack.id, {
          onSuccess: () => router.replace('/'),
          onError: (error) => notify(t(packErrorKey(error))),
        }),
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack(`/pack/${pack.id}`)} hitSlop={12}>
          <AppText variant="caption">{t('pack.back')}</AppText>
        </Pressable>
        <AppText variant="heading">{t('settings.title')}</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <TextField
          label={t('settings.name')}
          value={name}
          maxLength={PACK_NAME_MAX}
          editable={isAdmin}
          onChangeText={setName}
        />

        <AppText variant="caption">{t('settings.restDays')}</AppText>
        <View style={styles.row}>
          {Array.from({ length: REST_DAYS_MAX + 1 }, (_, days) => (
            <Choice
              key={days}
              label={t('packs.restDays', { count: days })}
              selected={restDays === days}
              onPress={() => isAdmin && setRestDays(days)}>
              <AppText variant="heading">{days}</AppText>
            </Choice>
          ))}
        </View>

        <AppText variant="caption">{t('settings.weekStart')}</AppText>
        <View style={styles.row}>
          {(['sunday', 'monday'] as const).map((day) => (
            <Choice key={day} label={t(`settings.${day}`)} selected={weekStart === day} onPress={() => isAdmin && setWeekStart(day)}>
              <AppText>{t(`settings.${day}`)}</AppText>
            </Choice>
          ))}
        </View>

        {pack.pending_from && (
          <AppText variant="caption">{t('settings.pending', { date: formatDay(pack.pending_from) })}</AppText>
        )}

        {isAdmin && (
          <Button
            label={updatePack.isSuccess && !changed ? t('settings.saved') : t('settings.save')}
            disabled={!changed || name.trim().length === 0}
            loading={updatePack.isPending}
            onPress={onSave}
          />
        )}

        <AppText variant="caption">{t('settings.members')}</AppText>
        <View style={styles.members}>
          {members.map((member) => {
            const memberName = member.profiles?.display_name ?? '…';
            return (
              <View key={member.user_id} style={styles.memberRow}>
                <AppText style={styles.memberName}>{memberName}</AppText>
                {member.role === 'admin' && <AppText variant="caption">{t('settings.admin')}</AppText>}
                {isAdmin && member.user_id !== userId && (
                  <Pressable accessibilityRole="button" onPress={() => onRemove(member.user_id, memberName)} hitSlop={8}>
                    <AppText variant="caption" style={styles.danger}>
                      {t('settings.remove')}
                    </AppText>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <PauseSection packId={pack.id} />

        <Button label={t('settings.invite')} variant="secondary" onPress={() => router.push(`/pack/${pack.id}/invite`)} />
        <Button label={t('settings.leave')} variant="secondary" loading={leavePack.isPending} onPress={onLeave} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  headerSpacer: { width: 32 },
  body: { gap: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  members: { borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberName: { flex: 1 },
  danger: { color: colors.danger },
});
