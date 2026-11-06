import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { DayResultRow } from '@/features/social/api';
import { colors, spacing } from '@/theme/tokens';

type Cell = 'fed' | 'rest' | 'away' | 'missed' | 'none' | 'open' | 'future';

type Member = { id: string; name: string | null; left: boolean };

type Props = {
  month: string;
  results: DayResultRow[];
  members: Member[];
  today: string;
  fedToday: Set<string>;
  color: string;
};

const DAY_LISTS = ['fed_ids', 'rested_ids', 'joker_ids', 'paused_ids', 'sleeping_ids', 'missed_ids'] as const;

function daysIn(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year ?? 2000, monthNumber ?? 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function cellFor(member: Member, day: string, result: DayResultRow | undefined, today: string, fedToday: Set<string>): Cell {
  if (result) {
    if (result.fed_ids.includes(member.id)) return 'fed';
    if (result.rested_ids.includes(member.id) || result.joker_ids.includes(member.id)) return 'rest';
    if (result.paused_ids.includes(member.id) || result.sleeping_ids.includes(member.id)) return 'away';
    if (result.missed_ids.includes(member.id)) return 'missed';
    return 'none';
  }
  // The day's close doesn't count a member who left, whatever they did today.
  if (day === today) return member.left ? 'none' : fedToday.has(member.id) ? 'fed' : 'open';
  return day > today ? 'future' : 'none';
}

/**
 * Who fed, rested, was away or missed on each day of the month (spec section 7). Every state
 * has its own shape as well as its color. A member who left keeps their row in the months whose
 * closed days list them.
 */
export function MonthlyBoard({ month, results, members, today, fedToday, color }: Props) {
  const { t } = useTranslation();
  const days = daysIn(month);
  const byDay = new Map(results.map((result) => [result.day, result]));
  const rows = members.filter((member) => !member.left || results.some((result) => DAY_LISTS.some((list) => result[list].includes(member.id))));
  const cellStyle = (cell: Cell, base: object = styles.cell) => [
    base,
    cell === 'fed' && { backgroundColor: color },
    cell === 'rest' && styles.rest,
    cell === 'away' && styles.away,
    cell === 'missed' && styles.missed,
    cell === 'open' && styles.open,
  ];

  return (
    <View style={styles.board}>
      <View style={styles.row}>
        <View style={styles.nameColumn} />
        {days.map((day) => {
          const number = Number(day.slice(8));
          return (
            <AppText key={day} style={[styles.dayNumber, day === today && styles.todayNumber]}>
              {number === 1 || number % 5 === 0 ? number : ''}
            </AppText>
          );
        })}
      </View>
      {rows.map((member) => {
        const cells = days.map((day) => cellFor(member, day, byDay.get(day), today, fedToday));
        const count = (kind: Cell) => cells.filter((cell) => cell === kind).length;
        const summary = t('profile.boardRow', {
          name: member.name ?? '…',
          fed: count('fed'),
          rest: count('rest'),
          away: count('away'),
          missed: count('missed'),
        });
        return (
          <View key={member.id} style={styles.row} accessible accessibilityLabel={summary}>
            <AppText variant="caption" numberOfLines={1} style={styles.nameColumn}>
              {member.name ?? '…'}
            </AppText>
            {cells.map((cell, index) => (
              <View key={days[index]} style={cellStyle(cell)}>
                {cell === 'missed' && <View style={styles.missedMark} />}
              </View>
            ))}
          </View>
        );
      })}
      <View style={styles.legend}>
        {(
          [
            ['fed', t('profile.legendFed')],
            ['rest', t('profile.legendRest')],
            ['away', t('profile.legendAway')],
            ['missed', t('profile.legendMissed')],
          ] as const
        ).map(([cell, label]) => (
          <View key={cell} style={styles.legendItem}>
            <View style={cellStyle(cell, styles.legendCell)}>{cell === 'missed' && <View style={styles.missedMark} />}</View>
            <AppText variant="caption">{label}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  nameColumn: { width: 52 },
  dayNumber: { flex: 1, fontSize: 9, lineHeight: 12, textAlign: 'center', color: colors.inkMuted },
  todayNumber: { color: colors.accentText },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 2, backgroundColor: '#F1EAE0', overflow: 'hidden' },
  rest: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inkMuted },
  away: { backgroundColor: '#D9D3EA' },
  missed: { backgroundColor: '#F4CFC9' },
  missedMark: { position: 'absolute', left: '15%', right: '15%', top: '45%', height: 1.5, backgroundColor: colors.danger },
  open: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Its own size, not the grid's flexible square: the legend sits in a row of labels.
  legendCell: { width: 12, height: 12, borderRadius: 2, backgroundColor: '#F1EAE0', overflow: 'hidden' },
});
