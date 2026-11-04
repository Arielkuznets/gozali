import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LoadFailed } from '@/components/ScreenStates';
import { TextField } from '@/components/TextField';
import { socialErrorKey, useChooseName, useNameSuggestions, useSuggestName } from '@/features/social/api';
import { confirm, notify } from '@/lib/confirm';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const NAME_MAX = 20;

type Props = {
  packId: string;
  critter: string;
  isAdmin: boolean;
  adminName: string;
  names: Map<string, string | null>;
};

/** "Name me!" after hatching (spec section 4): anyone suggests, the admin picks. */
export function NameMeCard({ packId, critter, isAdmin, adminName, names }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const suggestions = useNameSuggestions(packId, true);
  const suggest = useSuggestName(packId);
  const choose = useChooseName(packId);
  const fail = (error: unknown) => notify(t(socialErrorKey(error)));
  // choose_name sets the name only while there is none, so a pick can't be taken back.
  const onPick = (suggestion: { id: string; name: string }) =>
    confirm({
      title: t('social.pickConfirm', { name: suggestion.name }),
      message: t('social.pickBody'),
      confirm: t('social.pick'),
      cancel: t('social.cancel'),
      onConfirm: () => choose.mutate(suggestion.id, { onError: fail }),
    });

  return (
    <View style={styles.card}>
      <AppText variant="heading">{t('social.nameMeTitle')}</AppText>
      <AppText style={styles.muted}>
        {isAdmin ? t('social.nameMeBodyAdmin', { critter }) : t('social.nameMeBody', { critter, admin: adminName })}
      </AppText>
      {suggestions.isError && !suggestions.data && <LoadFailed onRetry={() => void suggestions.refetch()} />}
      {suggestions.data?.map((suggestion) => (
        <View key={suggestion.id} style={styles.row}>
          <View style={styles.fill}>
            <AppText style={styles.name}>{suggestion.name}</AppText>
            <AppText variant="caption">{t('social.by', { name: names.get(suggestion.user_id) ?? '…' })}</AppText>
          </View>
          {isAdmin && (
            <Button
              label={t('social.pick')}
              size="small"
              disabled={choose.isPending}
              onPress={() => onPick(suggestion)}
            />
          )}
        </View>
      ))}
      <View style={styles.row}>
        <View style={styles.fill}>
          <TextField value={name} onChangeText={setName} maxLength={NAME_MAX} placeholder={t('social.suggestPlaceholder')} />
        </View>
        <Button
          label={t('social.suggest')}
          variant="secondary"
          size="small"
          disabled={name.trim().length === 0}
          loading={suggest.isPending}
          onPress={() => suggest.mutate(name.trim(), { onSuccess: () => setName(''), onError: fail })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: '#FFF4E8',
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  muted: { color: colors.inkMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fill: { flex: 1 },
  name: { fontFamily: fonts.bodyMedium },
});
