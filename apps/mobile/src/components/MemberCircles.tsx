import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts } from '@/theme/tokens';

export type MemberState = 'fed' | 'pass' | 'waiting' | 'asleep' | 'paused';

type Member = { id: string; name: string | null; state: MemberState; nudgeable?: boolean };

/**
 * The row of member circles on the pack screen (spec section 9): filled = fed today, dashed =
 * rest or joker, 💤 = asleep or paused, gray = not yet. Each state also has its own mark or
 * outline, so color is not the only signal.
 */
type Props = { members: Member[]; color: string; onNudge?: (member: Member) => void };

export function MemberCircles({ members, color, onNudge }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {members.map((member) => {
        const name = member.name ?? '…';
        const label = t(`pack.member.${member.state}`, { name });
        const resting = member.state === 'asleep' || member.state === 'paused';
        return (
          <Pressable
            key={member.id}
            style={styles.item}
            accessibilityRole={member.nudgeable && onNudge ? 'button' : undefined}
            accessibilityLabel={label}
            disabled={!member.nudgeable || !onNudge}
            onPress={() => onNudge?.(member)}>
            <View
              style={[
                styles.circle,
                member.state === 'fed' && { backgroundColor: color, borderColor: color },
                member.state === 'pass' && styles.dashed,
              ]}>
              <AppText style={styles.initial}>{resting ? '💤' : initial(member.name)}</AppText>
              {member.state === 'fed' && (
                <View style={styles.badge}>
                  <AppText style={styles.badgeText}>✓</AppText>
                </View>
              )}
            </View>
            <AppText variant="caption" numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
          </Pressable>
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
  dashed: { borderStyle: 'dashed', borderColor: colors.inkMuted, backgroundColor: colors.surface },
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
