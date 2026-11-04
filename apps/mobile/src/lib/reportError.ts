import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const PENDING_KEY = 'gozali.pending-error';

type ErrorReport = { message: string; stack: string | null; screen: string | null; fatal: boolean };

function describe(error: unknown, screen: string | null, fatal: boolean): ErrorReport {
  const known = error instanceof Error;
  return {
    message: known ? `${error.name}: ${error.message}` : errorText(error),
    stack: known ? (error.stack ?? null) : null,
    screen,
    fatal,
  };
}

/** The store version, and the update it runs when one was downloaded. */
function appVersion(): string {
  const version = Constants.expoConfig?.version ?? '?';
  return Updates.updateId ? `${version} (${Updates.updateId.slice(0, 8)})` : version;
}

async function send(report: ErrorReport): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('report_app_error', {
    error_message: report.message,
    error_stack: report.stack ?? undefined,
    screen: report.screen ?? undefined,
    device: Platform.OS,
    app_version: appVersion(),
    fatal: report.fatal,
  });
  if (error) throw error;
}

/**
 * Tells the developer about an error on this phone (a table only the developer reads). Never
 * throws: reporting must not make things worse. Signed out, nothing is sent.
 */
export function reportError(error: unknown, screen: string | null = null): void {
  void send(describe(error, screen, false)).catch(() => undefined);
}

/** The code a native module or the server gave the error, if any. */
export function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && error.code != null ? String(error.code) : null;
}

/**
 * What a report can say about anything thrown. A refusal from the server is a plain object: its
 * details and hint stay out, because they can quote a row with someone's words in it.
 */
export function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  return [errorCode(error), errorMessage(error)].filter(Boolean).join(' ') || 'An object without a message';
}

/**
 * Tells the developer why a sign-in didn't finish, cancellations included: Apple's own failures can
 * look like the user closing the sheet, and a failure before anyone is signed in leaves no other
 * trace (App Review once couldn't sign in on an iPad and the server saw nothing). The same code
 * comes back for a sheet that never opened and one that was closed, so `elapsedMs`, the time since
 * the tap, is what tells them apart. Never throws.
 */
export function reportSignInProblem(provider: string, error: unknown, elapsedMs: number): void {
  if (!supabase) return;
  const message = errorMessage(error) || errorText(error);
  const { systemName, osVersion } = Platform.constants as { systemName?: string; osVersion?: string };
  const system = `${systemName ?? Platform.OS} ${osVersion ?? Platform.Version}`;
  void supabase
    .rpc('report_sign_in_problem', {
      problem: `${provider} ${errorCode(error) ?? 'no code'} after ${elapsedMs} ms: ${message} (${system})`,
      device: Platform.OS,
      app_version: appVersion(),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

let coveredWaitReported = false;

/**
 * Tells the developer a sign-in has had no answer from Apple for `elapsedMs`, and the state the app
 * was in. Active means nothing is over the app, so Apple has gone silent, and every one is reported.
 * Any other state most likely means someone is on the sheet, and their answer gets a report of its
 * own. One row per run of the app shows what the sheet does to the app on that device: more would
 * push real answers out of the hourly cap on sign-in reports. Never throws.
 */
export function reportSignInWait(provider: string, appState: string, elapsedMs: number): void {
  if (appState !== 'active') {
    if (coveredWaitReported) return;
    coveredWaitReported = true;
  }
  reportSignInProblem(provider, new Error(`No answer yet, app ${appState}`), elapsedMs);
}

type RejectionTracking = { allRejections: boolean; onUnhandled: (id: number, rejection: unknown) => void };
type Hermes = { enablePromiseRejectionTracker?: (options: RejectionTracking) => void };

/**
 * Catches JavaScript errors nothing else handled. A fatal one closes the app before a request
 * could finish, so it is kept on the phone and sent on the next start.
 */
export function watchForCrashes(): void {
  if (Platform.OS === 'web' || typeof ErrorUtils === 'undefined') return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const report = describe(error, null, Boolean(isFatal));
    if (isFatal) void AsyncStorage.setItem(PENDING_KEY, JSON.stringify(report)).catch(() => undefined);
    else void send(report).catch(() => undefined);
    previous(error, isFatal);
  });
  // A promise that rejects with nothing to handle it never reaches the handler above. React Native
  // tracks those only in a development build, which shows them on screen; a store build drops them.
  if (!__DEV__) {
    (globalThis as { HermesInternal?: Hermes }).HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => void send(describe(rejection, null, false)).catch(() => undefined),
    });
  }
}

/** Sends the report of an error that closed the app last time, once someone is signed in. */
export async function sendPendingCrash(): Promise<void> {
  const saved = await AsyncStorage.getItem(PENDING_KEY).catch(() => null);
  if (!saved) return;
  try {
    await send(JSON.parse(saved) as ErrorReport);
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // Offline: the next start tries again.
  }
}
