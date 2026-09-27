import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { choosePack, renderFor } from '@/features/widgets/android/task';
import { loadSnapshot, type WidgetSnapshot } from '@/features/widgets/data';
import i18n from '@/i18n';

// Choosing the pack a single-pack widget shows (spec section 9). This screen runs outside the
// app's navigation and fonts, so it keeps to plain components and reads texts from i18n directly.

const INK = '#3B2F2A';
const MUTED = '#7A6A60';

export function WidgetConfigurationScreen({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadSnapshot().then((saved) => {
      setSnapshot(saved);
      setLoaded(true);
    });
  }, []);

  const pick = async (packId: string) => {
    await choosePack(widgetInfo.widgetId, packId);
    renderWidget(await renderFor(widgetInfo.widgetName, widgetInfo.widgetId, snapshot));
    setResult('ok');
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{i18n.t('widgets.whichPack')}</Text>
      {loaded && (!snapshot || snapshot.packs.length === 0) && (
        <Text style={styles.muted}>{i18n.t('widgets.openFirst')}</Text>
      )}
      <ScrollView contentContainerStyle={styles.list}>
        {snapshot?.packs.map((pack) => (
          <Pressable key={pack.id} onPress={() => void pick(pack.id)} style={styles.row}>
            <Text style={styles.name}>{pack.name}</Text>
            <Text style={styles.muted}>{pack.critterName}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable onPress={() => setResult('cancel')} style={styles.cancel}>
        <Text style={styles.muted}>{i18n.t('widgets.cancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FBF6EE', padding: 24, gap: 16 },
  title: { fontSize: 22, color: INK, fontWeight: '600' },
  list: { gap: 8 },
  row: { padding: 16, borderRadius: 16, backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#EADFD2' },
  name: { fontSize: 17, color: INK },
  muted: { fontSize: 14, color: MUTED },
  cancel: { alignSelf: 'center', padding: 12 },
});
