import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { LoadingScreen, PackMissingScreen } from '@/components/ScreenStates';
import { usePack } from '@/features/packs/api';
import { inviteLink } from '@/features/packs/constants';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function InviteScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending } = usePack(id);
  const [copied, setCopied] = useState(false);

  if (isPending) return <LoadingScreen />;
  if (!pack) return <PackMissingScreen />;

  const link = inviteLink(pack.invite_code);

  const onShare = () => {
    void Share.share({ message: t('invite.message', { name: pack.name, code: pack.invite_code, link }) });
  };

  const onCopy = async () => {
    await Clipboard.setStringAsync(pack.invite_code);
    setCopied(true);
  };

  return (
    <Screen>
      <View style={styles.body}>
        <AppText variant="heading" style={styles.centerText}>
          {t('invite.title')}
        </AppText>
        <AppText style={[styles.centerText, styles.muted]}>{t('invite.body')}</AppText>
        <View style={styles.qr}>
          <QRCode value={link} size={180} color={colors.ink} backgroundColor={colors.surface} />
        </View>
        <AppText variant="caption">{t('invite.code')}</AppText>
        <AppText style={styles.code} selectable>
          {pack.invite_code}
        </AppText>
      </View>

      <View style={styles.actions}>
        <Button label={t('invite.share')} onPress={onShare} />
        <Button
          label={copied ? t('invite.copied') : t('invite.copy')}
          variant="secondary"
          onPress={() => void onCopy()}
        />
        <Button label={t('invite.done')} variant="secondary" onPress={() => router.replace(`/pack/${id}`)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted, maxWidth: 320 },
  qr: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
  code: { fontFamily: fonts.bodyBold, fontSize: 32, letterSpacing: 4 },
  actions: { gap: spacing.sm },
});
