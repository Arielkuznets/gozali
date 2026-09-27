import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/Screen';
import { RulesCards } from '@/features/profile/RulesCards';
import { goBack } from '@/lib/navigation';

/** The first-launch rules again, opened from the settings. */
export default function HowItWorksScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <RulesCards onDone={() => goBack('/settings')} doneLabel={t('onboarding.gotIt')} />
    </Screen>
  );
}
