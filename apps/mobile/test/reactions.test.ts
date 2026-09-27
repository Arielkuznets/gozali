import type { ReactionTotal } from '@/features/social/api';
import { withMyReaction } from '@/features/social/reactions';

const fire = (total: number, mine = false): ReactionTotal => ({ emoji: 'fire', total, mine, names: [] });
const clap = (total: number, mine = false): ReactionTotal => ({ emoji: 'clap', total, mine, names: [] });

describe('withMyReaction', () => {
  it('adds a first reaction', () => {
    expect(withMyReaction([], 'fire')).toEqual([fire(1, true)]);
  });

  it('joins others on the same emoji', () => {
    expect(withMyReaction([fire(2)], 'fire')).toEqual([fire(3, true)]);
  });

  it('moves my reaction to another emoji', () => {
    expect(withMyReaction([fire(2, true), clap(1)], 'clap')).toEqual([fire(1), clap(2, true)]);
  });

  it('takes my reaction back, and drops an emoji nobody is left on', () => {
    expect(withMyReaction([fire(1, true), clap(1)], null)).toEqual([clap(1)]);
  });
});
