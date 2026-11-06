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

  it('is reported once a run when it keeps coming back, and other ones still are', () => {
    for (let time = 1; time <= 3; time += 1) handler(new Error('Failed to write value.'), false);
    handler(new TypeError('undefined is not a function'), false);

    expect(sent('report_app_error').map((report) => report.error_message)).toEqual([
      'Error: Failed to write value.',
      'TypeError: undefined is not a function',
    ]);
  });
});

describe('a promise that rejects with nothing to handle it', () => {
  type Tracking = { allRejections?: boolean; onUnhandled: (id: number, rejection: unknown) => void };
  const runtime = globalThis as { __DEV__?: boolean; HermesInternal?: unknown; ErrorUtils?: unknown };
  const real = { dev: runtime.__DEV__, hermes: runtime.HermesInternal, utils: runtime.ErrorUtils };
  let trackers: Tracking[];

  beforeEach(() => {
    trackers = [];
    runtime.HermesInternal = { enablePromiseRejectionTracker: (options: Tracking) => trackers.push(options) };
    runtime.ErrorUtils = { getGlobalHandler: () => () => undefined, setGlobalHandler: () => undefined };
  });

  afterEach(() => {
    runtime.__DEV__ = real.dev;
    runtime.HermesInternal = real.hermes;
    runtime.ErrorUtils = real.utils;
  });

  it('is reported from a store build, where React Native tracks none', () => {
    runtime.__DEV__ = false;
    watchForCrashes();

    expect(trackers).toHaveLength(1);
    expect(trackers[0]?.allRejections).toBe(true);
    trackers[0]?.onUnhandled(1, new Error('x'));
    expect(sent('report_app_error')).toEqual([expect.objectContaining({ error_message: 'Error: x', fatal: false })]);
  });

  it('is reported once a run when it keeps coming back, and other ones still are', () => {
    runtime.__DEV__ = false;
    watchForCrashes();

    for (let refresh = 1; refresh <= 3; refresh += 1) trackers[0]?.onUnhandled(refresh, new Error('Failed to write value.'));
    trackers[0]?.onUnhandled(4, new TypeError('undefined is not a function'));

    expect(sent('report_app_error').map((report) => report.error_message)).toEqual([
      'Error: Failed to write value.',
      'TypeError: undefined is not a function',
    ]);
  });

  it("is left to React Native's own tracker in a development build, which shows it on screen", () => {
    runtime.__DEV__ = true;
    watchForCrashes();

    expect(trackers).toEqual([]);
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

describe('a sign-in with no answer from Apple yet', () => {
  /** The module as a new start of the app finds it. */
  function newRun() {
    type Reports = typeof import('@/lib/reportError');
    let reports: Reports | undefined;
    jest.isolateModules(() => {
      reports = jest.requireActual<Reports>('@/lib/reportError');
    });
    return reports!;
  }

  const problems = () => sent('report_sign_in_problem').map(({ problem }) => problem);

  it('is reported every time with the app active', () => {
    const { reportSignInWait } = newRun();
    reportSignInWait('apple', 'active', 15_000);
    reportSignInWait('apple', 'active', 15_000);
    expect(problems()).toHaveLength(2);
    expect(problems()[0]).toContain('apple no code after 15000 ms: No answer yet, app active (');
  });

  it('is reported once a run in any other state, with the state in it', () => {
    const { reportSignInWait } = newRun();
    reportSignInWait('apple', 'inactive', 15_000);
    reportSignInWait('apple', 'inactive', 15_000);
    reportSignInWait('apple', 'background', 15_000);
    expect(problems()).toHaveLength(1);
    expect(problems()[0]).toContain('apple no code after 15000 ms: No answer yet, app inactive (');
  });

  it('is reported again in the next run', () => {
    newRun().reportSignInWait('apple', 'inactive', 15_000);
    newRun().reportSignInWait('apple', 'inactive', 15_000);
    expect(problems()).toHaveLength(2);
  });
});
