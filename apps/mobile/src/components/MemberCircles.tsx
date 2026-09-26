import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts } from '@/theme/tokens';

type Member = { id: string; name: string | null; asleep?: boolean };

/**
 * The row of member circles on the pack screen. Feeding states arrive with phase 4; for now
 * every member is shown as "not yet" (gray), and sleeping members get 💤.
 */
export function MemberCircles({ members }: { members: Member[] }) {
  return (
    <View style={styles.row}>
      {members.map((member) => (
        <View key={member.id} style={styles.item}>
          <View style={styles.circle}>
            <AppText style={styles.initial}>{member.asleep ? '💤' : initial(member.name)}</AppText>
          </View>
          <AppText variant="caption" numberOfLines={1} style={styles.name}>
            {member.name ?? '…'}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function initial(name: string | null): string {
  return (name?.trim()[0] ?? '?').toUpperCase();
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  item: { alignItems: 'center', width: 56, gap: 4 },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: fonts.bodyMedium, fontSize: 17 },
  name: { maxWidth: 56 },
});
