import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { spacing } from '@/theme/tokens';

export type ViewedPhoto = { id: string; url: string | null; caption: string | null; name: string };

/** A feed photo on the whole screen. Pinch to zoom where the platform's scroll view can. */
export function PhotoViewer({ photo, onClose }: { photo: ViewedPhoto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={photo !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        {photo?.url && (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.fill}
            maximumZoomScale={3}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}>
            <Pressable style={styles.fill} onPress={onClose} accessibilityLabel={t('feed.closePhoto')}>
              <Image
                source={{ uri: photo.url, cacheKey: photo.id }}
                style={styles.fill}
                contentFit="contain"
                accessibilityLabel={photo.caption ?? t('feed.photoBy', { name: photo.name })}
              />
            </Pressable>
          </ScrollView>
        )}
        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
          <AppText style={styles.light}>{photo?.name}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('feed.closePhoto')} onPress={onClose} hitSlop={12}>
            <AppText style={[styles.light, styles.close]}>✕</AppText>
          </Pressable>
        </View>
        {photo?.caption && (
          <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
            <AppText style={styles.light}>{photo.caption}</AppText>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, width: '100%' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  light: { color: '#fff' },
  close: { fontSize: 22, lineHeight: 26 },
});
