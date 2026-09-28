import { INVITE_CODE_LENGTH, categoryInfo, inviteLink, normalizeInviteCode } from '@/features/packs/constants';

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
});

describe('categories', () => {
  it('gives each habit its default rest days', () => {
    expect(categoryInfo('gym').defaultRestDays).toBe(3);
    expect(categoryInfo('water').defaultRestDays).toBe(0);
  });
});
