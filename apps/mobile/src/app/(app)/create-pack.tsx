import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Choice } from '@/components/Choice';
import { CritterPlaceholder } from '@/components/CritterPlaceholder';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { packErrorKey, useCreatePack } from '@/features/packs/api';
import {
  CATEGORIES,
  CRITTER_COLORS,
  CUSTOM_HABIT_MAX,
  PACK_NAME_MAX,
  REST_DAYS_MAX,
  SPECIES,
  type Category,
  type CritterColor,
  type Species,
} from '@/features/packs/constants';
import { critterColors, spacing } from '@/theme/tokens';

const STEPS = 4;

export default function CreatePackScreen() {
  const { t } = useTranslation();
  const createPack = useCreatePack();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('gym');
  const [customHabit, setCustomHabit] = useState('');
  const [restDays, setRestDays] = useState(3);
  const [species, setSpecies] = useState<Species>('blob');
  const [color, setColor] = useState<CritterColor>('peach');

  const pickCategory = (key: Category, defaultRestDays: number) => {
    setCategory(key);
    setRestDays(defaultRestDays);
  };

  const stepDone =
    (step === 1 && name.trim().length > 0) ||
    (step === 2 && (category !== 'custom' || customHabit.trim().length > 0)) ||
    step === 3 ||
    step === 4;

  const onNext = () => {
    if (step < STEPS) {
      setStep(step + 1);
      return;
    }
    createPack.mutate(
      {
        name: name.trim(),
        category,
        customHabit: category === 'custom' ? customHabit.trim() : null,
        restDays,
        species,
        color,
      },
      {
        onSuccess: (packId) => router.replace(`/pack/${packId}/invite`),
        onError: (error) => Alert.alert(t(packErrorKey(error))),
      },
    );
  };

  const onBack = () => (step === 1 ? router.back() : setStep(step - 1));

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="heading">{t('create.title')}</AppText>
        <AppText variant="caption">{t('create.step', { step })}</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {step === 1 && (
          <TextField
            label={t('create.nameLabel')}
            placeholder={t('create.namePlaceholder')}
            maxLength={PACK_NAME_MAX}
            value={name}
            onChangeText={setName}
            autoFocus
          />
        )}

        {step === 2 && (
          <>
            <AppText variant="heading">{t('create.categoryTitle')}</AppText>
            <View style={styles.grid}>
              {CATEGORIES.map((item) => (
                <Choice
                  key={item.key}
                  label={t(`packs.categories.${item.key}`)}
                  selected={category === item.key}
                  onPress={() => pickCategory(item.key, item.defaultRestDays)}>
                  <AppText style={styles.emoji}>{item.emoji}</AppText>
                  <AppText variant="caption">{t(`packs.categories.${item.key}`)}</AppText>
                </Choice>
              ))}
            </View>
            {category === 'custom' && (
              <TextField
                label={t('create.customLabel')}
                placeholder={t('create.customPlaceholder')}
                maxLength={CUSTOM_HABIT_MAX}
                value={customHabit}
                onChangeText={setCustomHabit}
              />
            )}
          </>
        )}

        {step === 3 && (
          <>
            <AppText variant="heading">{t('create.restTitle')}</AppText>
            <AppText>{t('create.restBody')}</AppText>
            <View style={styles.row}>
              {Array.from({ length: REST_DAYS_MAX + 1 }, (_, days) => (
                <Choice
                  key={days}
                  label={t('packs.restDays', { count: days })}
                  selected={restDays === days}
                  onPress={() => setRestDays(days)}>
                  <AppText variant="heading">{days}</AppText>
                </Choice>
              ))}
            </View>
            <AppText variant="caption">{t('packs.restDays', { count: restDays })}</AppText>
          </>
        )}

        {step === 4 && (
          <>
            <AppText variant="heading">{t('create.eggTitle')}</AppText>
            <View style={styles.row}>
              {SPECIES.map((item) => (
                <Choice
                  key={item}
                  label={t(`packs.species.${item}`)}
                  selected={species === item}
                  onPress={() => setSpecies(item)}>
                  <CritterPlaceholder
                    label={t(`packs.species.${item}`)}
                    size={56}
                    color={critterColors[color]}
                    species={item}
                  />
                  <AppText variant="caption">{t(`packs.species.${item}`)}</AppText>
                </Choice>
              ))}
            </View>
            <AppText variant="heading">{t('create.colorTitle')}</AppText>
            <View style={styles.row}>
              {CRITTER_COLORS.map((item) => (
                <Choice
                  key={item}
                  label={t(`packs.colors.${item}`)}
                  selected={color === item}
                  onPress={() => setColor(item)}>
                  <View style={[styles.swatch, { backgroundColor: critterColors[item] }]} />
                </Choice>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label={step === STEPS ? t('create.create') : t('create.next')}
          disabled={!stepDone}
          loading={createPack.isPending}
          onPress={onNext}
        />
        <Button label={t('create.back')} variant="secondary" onPress={onBack} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingVertical: spacing.md, gap: spacing.xs },
  body: { gap: spacing.lg, paddingBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emoji: { fontSize: 24 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  actions: { gap: spacing.sm },
});
