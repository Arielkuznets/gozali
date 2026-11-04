import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/Screen';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';
import { RulesCards } from '@/features/profile/RulesCards';

/** The rules on first launch (spec section 9). Shown once, and it can be skipped. */
export default function OnboardingScreen() {
  const { t } = useTranslation();

  const finish = async () => {
    // A phone that can't note it (a full disk) shows the rules again at the next launch, which is
    // better than no way on to sign-in.
    await AsyncStorage.setItem(ONBOARDED_KEY, '1').catch(() => undefined);
    router.replace('/welcome');
  };

  return (
    <Screen>
      <RulesCards onDone={() => void finish()} doneLabel={t('onboarding.start')} />
    </Screen>
  );
}
