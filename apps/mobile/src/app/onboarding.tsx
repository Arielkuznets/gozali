import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/Screen';
import { noteRulesSeen } from '@/features/profile/onboarding';
import { RulesCards } from '@/features/profile/RulesCards';

/** The rules on first launch (spec section 9). Shown once, and it can be skipped. */
export default function OnboardingScreen() {
  const { t } = useTranslation();

  const finish = async () => {
    await noteRulesSeen();
    router.replace('/welcome');
  };

  return (
    <Screen>
      <RulesCards onDone={() => void finish()} doneLabel={t('onboarding.start')} />
    </Screen>
  );
}
