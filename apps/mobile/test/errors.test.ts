import { feedErrorCode, isFinalRejection, isNetworkFailure } from '@/features/feeds/send';
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

  it('keeps a refusal that can pass on a later try', () => {
    // What storage answers an expired token with: a phone's clock can hide the expiry from auth-js.
    expect(isFinalRejection({ statusCode: '403', message: '"exp" claim timestamp check failed' })).toBe(false);
    expect(isFinalRejection({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isFinalRejection({ code: '40P01', message: 'deadlock detected' })).toBe(false);
    expect(isFinalRejection({ code: '53300', message: 'too many connections' })).toBe(false);
    expect(isFinalRejection({ statusCode: '408' })).toBe(false);
    expect(isFinalRejection({ statusCode: '423' })).toBe(false);
    expect(isFinalRejection({ statusCode: '429' })).toBe(false);
  });

  it('treats a refusal the same feed can never pass as final', () => {
    for (const code of ['P0002', '22023', '22P02', '23505', '42501']) {
      expect(isFinalRejection({ code, message: 'refused' })).toBe(true);
    }
    for (const statusCode of ['404', '413', '415']) {
      expect(isFinalRejection({ statusCode, message: 'refused' })).toBe(true);
    }
  });

  it('knows when the server gave no answer', () => {
    // What supabase-js hands back when fetch fails, from the database's API and from storage.
    expect(isNetworkFailure({ message: 'TypeError: Network request failed', details: '', hint: '', code: '' })).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error('Aborted'), { name: 'StorageUnknownError' }))).toBe(true);
    expect(isNetworkFailure(new Error('not_signed_in'))).toBe(true);
  });

  it('knows an answer, or a failure on the phone, from a network failure', () => {
    expect(isNetworkFailure({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isNetworkFailure({ statusCode: '503', message: 'Service Unavailable' })).toBe(false);
    expect(isNetworkFailure({ message: '<html>Bad gateway</html>' })).toBe(false);
    expect(isNetworkFailure(new Error('file not found'))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
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
