import type { CritterArt } from '@gozali/critter-art';
import { useTranslation } from 'react-i18next';

import type { PackCritter } from '@/features/packs/api';

/** The critter's name, its screen reader description and what it says when petted. */
export function useCritterText(critter: PackCritter, art: CritterArt) {
  const { t } = useTranslation();
  const name = critter.name ?? t(`packs.species.${critter.species}`);
  const health = critter.health;

  let label: string;
  let lines: readonly string[];
  if (art.look === 'egg') {
    label = t(art.cracking ? 'critter.a11y.eggCracking' : 'critter.a11y.egg', { name });
    lines = t('critter.lines.egg', { returnObjects: true });
  } else if (art.look === 'ran_away') {
    label = t('critter.a11y.ran_away', { name });
    lines = [];
  } else if (art.sleeping) {
    label = t('critter.a11y.sleeping', { name, health });
    lines = t(`critter.lines.${critter.species}.sleeping`, { returnObjects: true });
  } else {
    label = t(`critter.a11y.${art.look}`, { name, health });
    lines = t(`critter.lines.${critter.species}.${art.look}`, { returnObjects: true });
  }
  return { name, label, lines };
}
