import { isOlder } from '@/features/app/appConfig';

describe('isOlder', () => {
  it('compares each part as a number', () => {
    expect(isOlder('1.9.0', '1.10.0')).toBe(true);
    expect(isOlder('1.10.0', '1.9.0')).toBe(false);
    expect(isOlder('0.1.1', '1.0.0')).toBe(true);
    expect(isOlder('2.0.0', '1.99.99')).toBe(false);
  });

  it('is not older than the same version', () => {
    expect(isOlder('1.0.0', '1.0.0')).toBe(false);
    expect(isOlder('1.0.0', '0.0.0')).toBe(false);
  });
});
