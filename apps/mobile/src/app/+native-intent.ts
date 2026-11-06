import type { NativeIntent } from 'expo-router';

import { followPackLink } from '@/lib/navigation';

/** Links that reach the app while it runs. The one it starts from goes on as it is. */
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ path, initial }) => {
  // Whatever goes wrong here would end the app, and the link can still go the usual way.
  try {
    return !initial && followPackLink(path) ? null : path;
  } catch {
    return path;
  }
};
