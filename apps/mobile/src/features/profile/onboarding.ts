import AsyncStorage from '@react-native-async-storage/async-storage';

/** Set once the first-launch rules were shown (spec section 9: Onboarding, skippable). */
export const ONBOARDED_KEY = 'gozali.onboarded';

/** The rules were seen in this run: this holds on a phone that can't keep the note (a full disk). */
let seenThisRun = false;

/** Notes that the rules were seen. A phone that refuses the note shows them again at the next launch. */
export async function noteRulesSeen(): Promise<void> {
  seenThisRun = true;
  await AsyncStorage.setItem(ONBOARDED_KEY, '1').catch(() => undefined);
}

/** Whether the rules were seen, in this run or an earlier one. */
export async function rulesSeen(): Promise<boolean> {
  const noted = await AsyncStorage.getItem(ONBOARDED_KEY);
  return noted !== null || seenThisRun;
}
