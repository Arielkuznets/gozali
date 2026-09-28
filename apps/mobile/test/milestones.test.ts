import { milestoneFor } from '@/features/critter/milestones';

describe('critter milestones', () => {
  it('celebrates nothing the first time a pack is opened', () => {
    expect(milestoneFor(null, { status: 'active', stage: 'teen' })).toBeNull();
  });

  it('celebrates the hatching, even if the critter also grew since', () => {
    expect(milestoneFor({ status: 'egg', stage: 'egg' }, { status: 'active', stage: 'baby' })).toEqual({ kind: 'hatched' });
    expect(milestoneFor({ status: 'egg', stage: 'egg' }, { status: 'active', stage: 'kid' })).toEqual({ kind: 'hatched' });
  });

  it('celebrates a new stage', () => {
    expect(milestoneFor({ status: 'active', stage: 'kid' }, { status: 'active', stage: 'teen' })).toEqual({ kind: 'evolved', to: 'teen' });
  });

  it('celebrates the return after running away', () => {
    expect(milestoneFor({ status: 'ran_away', stage: 'kid' }, { status: 'active', stage: 'kid' })).toEqual({ kind: 'returned' });
  });

  it('stays quiet when nothing to celebrate happened', () => {
    expect(milestoneFor({ status: 'active', stage: 'kid' }, { status: 'active', stage: 'kid' })).toBeNull();
    expect(milestoneFor({ status: 'active', stage: 'kid' }, { status: 'ran_away', stage: 'kid' })).toBeNull();
  });
});
