// Notification texts in the critter's voice (spec sections 4 and 8). English for the pilot;
// Hebrew lines are written, not translated, for the launch. Texts never say who missed.

export type Species = 'blob' | 'spark' | 'mossy';
export type NotificationType =
  | 'friend_fed'
  | 'evening_reminder'
  | 'last_one'
  | 'nudge'
  | 'pet_state'
  | 'evolution'
  | 'still_in'
  | 'weekly_recap';

/** A row returned by claim_notifications. */
export interface ClaimedRow {
  id: string;
  user_id: string;
  pack_id: string | null;
  type: NotificationType;
  payload: Record<string, unknown>;
  locale: string;
  pack_name: string | null;
  critter_name: string | null;
  species: Species | null;
  names: string[];
  tokens: string[];
}

export interface Rendered {
  title: string;
  body: string;
  /** The screen the notification opens. */
  url: string;
}

const SPECIES_NAMES: Record<Species, string> = { blob: 'Blob', spark: 'Spark', mossy: 'Mossy' };
const STAGES: Record<string, string> = { baby: 'Baby', kid: 'Kid', teen: 'Teen', adult: 'Adult', legend: 'Legend' };
const ACHIEVEMENTS: Record<string, string> = {
  hatched: 'Hello world',
  streak_7: 'One week strong',
  streak_14: 'Two weeks strong',
  streak_30: 'Unbreakable',
  full_house: 'Full house',
  early_birds: 'Early birds',
  night_owls: 'Night owls',
  comeback: 'Comeback',
  century: 'Century',
  full_pack: 'Full pack',
  grown_up: 'Grown up',
  legend: 'Legend',
};

const VOICE: Record<'reminder' | 'last' | 'weak' | 'sick', Record<Species, string>> = {
  reminder: {
    blob: 'I was napping but also... starving? Feed me today 🥺',
    spark: 'Still waiting for your feed today. Dramatically. 🎭',
    mossy: "Fun fact: you haven't fed me today yet 🌱",
  },
  last: {
    blob: "Everyone fed me but you. I'll just... wait here 😴",
    spark: 'Everyone fed me. Everyone. Except. You. 👀',
    mossy: "Observation: you're the last one left today 🌱",
  },
  weak: {
    blob: "I'm getting a little floppy... a feed would help 🥺",
    spark: "I'm fading... tragically. Feed me? 🥀",
    mossy: 'My energy readings are low. Feeds recharge me 🔋',
  },
  sick: {
    blob: "I'm sick and I need a blanket. And feeds. Mostly feeds 🤒",
    spark: "I'm too gorgeous to be this sick. Help 🤒",
    mossy: 'Diagnosis: underfed. Prescription: feeds from the pack 🤒',
  },
};

export function render(row: ClaimedRow): Rendered {
  const species = row.species ?? 'blob';
  const critter = row.critter_name ?? SPECIES_NAMES[species];
  const pack = row.pack_name ?? 'Gozali';
  const home = row.pack_id ? `/pack/${row.pack_id}` : '/';
  const camera = row.pack_id ? `/pack/${row.pack_id}/feed` : '/';
  const event = String(row.payload.event ?? '');

  switch (row.type) {
    case 'friend_fed':
      return {
        title: pack,
        body: row.names.length === 1 ? `${row.names[0]} fed ${critter} 🍽️` : `${row.names.length} friends fed ${critter} 🍽️`,
        url: home,
      };
    case 'evening_reminder':
      return { title: critter, body: VOICE.reminder[species], url: camera };
    case 'last_one':
      return { title: critter, body: VOICE.last[species], url: camera };
    case 'nudge':
      return { title: pack, body: `${critter} is looking at you 👀`, url: camera };
    case 'pet_state':
      if (event === 'ran_away') {
        return { title: pack, body: `${critter} ran away to find food 🏃 Three good days in a row bring it back.`, url: home };
      }
      if (event === 'returned') return { title: pack, body: `${critter} is back! 🩹`, url: home };
      return { title: critter, body: VOICE[row.payload.to === 'sick' ? 'sick' : 'weak'][species], url: camera };
    case 'evolution':
      if (event === 'hatched') return { title: pack, body: '🐣 The egg hatched! Come meet your new pet.', url: home };
      if (event === 'achievement') {
        const title = ACHIEVEMENTS[String(row.payload.key)] ?? 'an achievement';
        return { title: pack, body: `🏆 ${critter} unlocked ${title}! There's something new in the wardrobe.`, url: home };
      }
      const stage = STAGES[String(row.payload.to)];
      return { title: pack, body: stage ? `✨ ${critter} reached the ${stage} stage!` : `✨ ${critter} grew up!`, url: home };
    case 'still_in':
      return { title: pack, body: 'Still in? Your pack misses you 💛', url: row.pack_id ? `/pack/${row.pack_id}/settings` : '/' };
    case 'weekly_recap':
      return { title: pack, body: 'Your weekly recap is ready 📊', url: row.pack_id ? `/pack/${row.pack_id}/recap` : '/' };
  }
}
