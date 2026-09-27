import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts } from '@/theme/tokens';

export type MemberState = 'fed' | 'waiting' | 'asleep';

type Member = { id: string; name: string | null; state: MemberState };

/**
 * The row of member circles on the pack screen (spec section 9): filled = fed today,
 * gray = not yet, 💤 = asleep. Each state also has its own mark, so color is not the only signal.
 */
export function MemberCircles({ members, color }: { members: Member[]; color: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {members.map((member) => {
        const name = member.name ?? '…';
        const label =
          member.state === 'fed'
            ? t('pack.memberFed', { name })
            : member.state === 'asleep'
              ? t('pack.memberAsleep', { name })
              : t('pack.memberWaiting', { name });
        return (
          <View key={member.id} style={styles.item} accessible accessibilityLabel={label}>
            <View style={[styles.circle, member.state === 'fed' && { backgroundColor: color, borderColor: color }]}>
              <AppText style={styles.initial}>{member.state === 'asleep' ? '💤' : initial(member.name)}</AppText>
              {member.state === 'fed' && (
                <View style={styles.badge}>
                  <AppText style={styles.badgeText}>✓</AppText>
                </View>
              )}
            </View>
            <AppText variant="caption" numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function initial(name: string | null): string {
  return (name?.trim()[0] ?? '?').toUpperCase();
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  item: { alignItems: 'center', width: 60, gap: 4 },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: fonts.bodyMedium, fontSize: 17 },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onAccent, fontSize: 11, lineHeight: 14, fontFamily: fonts.bodyBold },
  name: { maxWidth: 60 },
});
