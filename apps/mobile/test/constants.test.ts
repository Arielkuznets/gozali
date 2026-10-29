import { INVITE_CODE_LENGTH, categoryInfo, inviteCodeFrom, inviteLink, normalizeInviteCode } from '@/features/packs/constants';

describe('invite codes', () => {
  it('upper-cases and drops spaces and dashes', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
  });

  it('drops the look-alike characters the codes never use', () => {
    expect(normalizeInviteCode('O0I1abc')).toBe('ABC');
  });

  it('keeps at most eight characters', () => {
    expect(normalizeInviteCode('ABCDEFGHJK')).toHaveLength(INVITE_CODE_LENGTH);
  });

  it('builds the public invite link', () => {
    expect(inviteLink('ABCD2345')).toBe('https://gozali.app/i/ABCD2345');
  });

  it('finds the code in a pasted invite message or link', () => {
    const message = 'Join my pack "Code: 2 runs" on Gozali! Code: ABCD2345\nhttps://gozali.app/i/ABCD2345';
    expect(inviteCodeFrom(message)).toBe('ABCD2345');
    expect(inviteCodeFrom('https://gozali.app/i/abcd2345')).toBe('ABCD2345');
    expect(inviteCodeFrom('gozali://i/ABCD2345')).toBe('ABCD2345');
    expect(inviteCodeFrom('Code: abcd-2345')).toBe('ABCD2345');
  });

  it('reads anything else as the code itself', () => {
    expect(inviteCodeFrom(' abcd 2345 ')).toBe('ABCD2345');
    expect(inviteCodeFrom('ABC')).toBe('ABC');
  });
});

describe('categories', () => {
  it('gives each habit its default rest days', () => {
    expect(categoryInfo('gym').defaultRestDays).toBe(3);
    expect(categoryInfo('water').defaultRestDays).toBe(0);
  });
});
