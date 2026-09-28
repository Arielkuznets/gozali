import { feedErrorCode, isFinalRejection } from '@/features/feeds/send';
import { isBlockedText } from '@/lib/errors';

describe('feed errors', () => {
  it('treats a database refusal as final', () => {
    expect(isFinalRejection({ code: 'P0001', message: 'already_fed' })).toBe(true);
    expect(isFinalRejection({ statusCode: '403', message: 'new row violates row-level security' })).toBe(true);
  });

  it('keeps network failures for a retry', () => {
    expect(isFinalRejection(new TypeError('Network request failed'))).toBe(false);
    expect(isFinalRejection({ message: 'TypeError: Network request failed', code: '' })).toBe(false);
    expect(isFinalRejection({ statusCode: '503' })).toBe(false);
  });

  it('names the refusals the app handles', () => {
    expect(feedErrorCode({ message: 'already_fed' })).toBe('already_fed');
    expect(feedErrorCode({ message: 'not_a_member' })).toBe('not_a_member');
    expect(feedErrorCode(new Error('boom'))).toBe('other');
  });

  it('recognizes text the word filter refused', () => {
    expect(isBlockedText({ message: 'text_not_allowed' })).toBe(true);
    expect(isBlockedText(null)).toBe(false);
  });
});
