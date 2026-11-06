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

  it('finds a code written in somebody\'s own words', () => {
    expect(inviteCodeFrom('Code KPQR5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('my code is KPQR5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('Join us! kpqr 5678 :)')).toBe('KPQR5678');
    expect(inviteCodeFrom('code=KPQR5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('CODE : KPQR-5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('gozali://join?code=KPQR5678')).toBe('KPQR5678');
  });

  it('reads a code typed in full-width characters', () => {
    expect(inviteCodeFrom('ＫＰＱＲ５６７８')).toBe('KPQR5678');
  });

  it('takes a word with a digit over an English word of the same letters, and the last word otherwise', () => {
    expect(inviteCodeFrom('KPQR5678 is for the STRENGTH squad')).toBe('KPQR5678');
    expect(inviteCodeFrom('strength squad: WXYZABCD')).toBe('WXYZABCD');
  });

  // The app and its site show a code in capitals, which a word in a sentence rarely is.
  it('takes a code in capitals over a word of the same letters after it', () => {
    expect(inviteCodeFrom('WXYZABCD starts next week')).toBe('WXYZABCD');
    expect(inviteCodeFrom('WXYZABCD, Thursday 7pm')).toBe('WXYZABCD');
    expect(inviteCodeFrom('WXYZABCD see you Saturday')).toBe('WXYZABCD');
    expect(inviteCodeFrom('WXYZABCD for the pack name Gym squad')).toBe('WXYZABCD');
    expect(inviteCodeFrom('pack WXYZ ABCD')).toBe('WXYZABCD');
  });

  it('finds a code written in two halves right after a short word', () => {
    expect(inviteCodeFrom('my pack KPQR 5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('join the club kpqr 5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('here KPQR-5678')).toBe('KPQR5678');
    expect(inviteCodeFrom('my pack k7qr 5m8x')).toBe('K7QR5M8X');
  });

  // Its second half and the word after it make a code of the same rank, which starts inside it.
  it('finds a code written in two halves before a short word', () => {
    expect(inviteCodeFrom('kpqr 5678 then tap Join')).toBe('KPQR5678');
    expect(inviteCodeFrom('kpqr 5678 have fun')).toBe('KPQR5678');
    expect(inviteCodeFrom("kpqr-5678 here's the code")).toBe('KPQR5678');
    expect(inviteCodeFrom('abcd 2345 next week')).toBe('ABCD2345');
    expect(inviteCodeFrom('KPQR 5678 ASAP')).toBe('KPQR5678');
    expect(inviteCodeFrom('wxyz abcd then')).toBe('WXYZABCD');
  });

  it('takes the later of two words of the same rank that are apart', () => {
    expect(inviteCodeFrom('strength squad: wxyzabcd')).toBe('WXYZABCD');
  });

  it('finds the code in the sentence the review notes give', () => {
    const notes =
      'To see a hatched pet, a friend\'s photos, the outfit shop and a weekly recap, tap "Join with a code" on the home screen and enter WXYZ2345. To hatch your own egg, a second account joins with the pack\'s code (Invite on the pack screen) and feeds the same day.';
    expect(inviteCodeFrom(notes)).toBe('WXYZ2345');
  });

  it('reads anything else as the code itself', () => {
    expect(inviteCodeFrom(' abcd 2345 ')).toBe('ABCD2345');
    expect(inviteCodeFrom('ABC')).toBe('ABC');
    expect(inviteCodeFrom('Code: ABCD234')).toBe('ABCD234');
  });
});

describe('categories', () => {
  it('gives each habit its default rest days', () => {
    expect(categoryInfo('gym').defaultRestDays).toBe(3);
    expect(categoryInfo('water').defaultRestDays).toBe(0);
  });
});
