import AsyncStorage from '@react-native-async-storage/async-storage';
import { stageRank, type CritterStatus, type Stage } from '@gozali/game-engine';
import { useEffect, useState } from 'react';

/** What this phone last showed of a pack's critter. */
export type Seen = { status: CritterStatus; stage: Stage };

export type Milestone = { kind: 'hatched' } | { kind: 'evolved'; to: Stage } | { kind: 'returned' };

/**
 * The moment to celebrate since the critter was last seen (spec section 4: every stage change
 * gets an animation). Nothing the first time a pack is opened on this phone.
 */
export function milestoneFor(seen: Seen | null, now: Seen): Milestone | null {
  if (!seen) return null;
  if (seen.status === 'egg' && now.status !== 'egg') return { kind: 'hatched' };
  if (seen.status === 'ran_away' && now.status === 'active') return { kind: 'returned' };
  if (stageRank(now.stage) > stageRank(seen.stage)) return { kind: 'evolved', to: now.stage };
  return null;
}

const key = (packId: string) => `gozali.seen.${packId}`;

async function loadSeen(packId: string): Promise<Seen | null> {
  try {
    const raw = await AsyncStorage.getItem(key(packId));
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
}

async function saveSeen(packId: string, seen: Seen): Promise<void> {
  await AsyncStorage.setItem(key(packId), JSON.stringify(seen)).catch(() => undefined);
}

/** The milestone waiting on this phone for the pack's critter, and a way to mark it seen. */
export function useMilestone(packId: string | undefined, critter: Seen | null | undefined) {
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const status = critter?.status;
  const stage = critter?.stage;

  useEffect(() => {
    if (!packId || !status || !stage) return;
    let current = true;
    void loadSeen(packId).then((seen) => {
      if (!current) return;
      const next = milestoneFor(seen, { status, stage });
      if (next) setMilestone(next);
      else void saveSeen(packId, { status, stage });
    });
    return () => {
      current = false;
    };
  }, [packId, status, stage]);

  const dismiss = () => {
    setMilestone(null);
    if (packId && status && stage) void saveSeen(packId, { status, stage });
  };
  return { milestone, dismiss };
}
