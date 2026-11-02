import { reportError, reportSignInProblem, watchForCrashes } from '@/lib/reportError';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('expo-updates', () => ({ updateId: null }));

/** A refusal from the server as supabase-js hands it over: a plain object, with the row in its details. */
const refusal = {
  code: '23514',
  message: 'new row for relation "feeds" violates check constraint "feeds_caption_check"',
  details: 'Failing row contains (Kicked ass today, noa@example.com).',
  hint: 'Check the caption',
};
const refusalText = '23514 new row for relation "feeds" violates check constraint "feeds_caption_check"';

const sent = (name: string) => mockRpc.mock.calls.filter(([rpc]) => rpc === name).map(([, args]) => args);

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ error: null });
});

describe('what an error report says', () => {
  const stored = () => sent('report_app_error')[0].error_message;

  it('gives the name and message of an Error, with its stack', () => {
    const error = new TypeError('undefined is not a function');
    reportError(error, '/pack/1');
    expect(sent('report_app_error')).toEqual([
      expect.objectContaining({ error_message: 'TypeError: undefined is not a function', error_stack: error.stack, screen: '/pack/1' }),
    ]);
  });

  it('gives the code and message of a plain object, and leaves out what can quote a row', () => {
    reportError(refusal);
    expect(stored()).toBe(refusalText);
  });

  it('gives what it has of a plain object with only some of that', () => {
    reportError({ message: 'Unexpected end of input' });
    reportError({ code: 'PGRST301' });
    expect(sent('report_app_error').map((report) => report.error_message)).toEqual(['Unexpected end of input', 'PGRST301']);
  });

  it('never stores what is in an object it can say nothing about', () => {
    reportError({ caption: 'Kicked ass today' });
    expect(stored()).toBe('An object without a message');
  });

  it('gives anything else as it is', () => {
    reportError('a string thrown as it was');
    reportError(undefined);
    expect(sent('report_app_error').map((report) => report.error_message)).toEqual(['a string thrown as it was', 'undefined']);
  });
});

describe('a JavaScript error nothing handled', () => {
  const realUtils = (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  let handler: (error: unknown, isFatal?: boolean) => void;

  beforeAll(() => {
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => () => undefined,
      setGlobalHandler: (next: typeof handler) => {
        handler = next;
      },
    };
    watchForCrashes();
  });

  afterAll(() => {
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = realUtils;
  });

  it('says what a plain object says', () => {
    handler(refusal, false);
    expect(sent('report_app_error')).toEqual([expect.objectContaining({ error_message: refusalText, fatal: false })]);
  });
});

describe('a sign-in report', () => {
  it('gives the message of a plain object, and leaves out what can quote a row', () => {
    reportSignInProblem('apple', refusal, 300);
    const [{ problem }] = sent('report_sign_in_problem');
    expect(problem).toContain(`apple 23514 after 300 ms: ${refusal.message} (`);
    expect(problem).not.toContain('object Object');
    expect(problem).not.toContain('Failing row');
  });
});
