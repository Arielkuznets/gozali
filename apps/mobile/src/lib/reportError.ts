import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const PENDING_KEY = 'gozali.pending-error';

type ErrorReport = { message: string; stack: string | null; screen: string | null; fatal: boolean };

function describe(error: unknown, screen: string | null, fatal: boolean): ErrorReport {
  const known = error instanceof Error;
  return {
    message: known ? `${error.name}: ${error.message}` : String(error),
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
 * Tells the developer why a sign-in didn't finish, cancellations included: Apple's own failures can
 * look like the user closing the sheet, and a failure before anyone is signed in leaves no other
 * trace (App Review once couldn't sign in on an iPad and the server saw nothing). Never throws.
 */
export function reportSignInProblem(provider: string, error: unknown): void {
  if (!supabase) return;
  const message = error instanceof Error ? error.message : String(error);
  const { systemName, osVersion } = Platform.constants as { systemName?: string; osVersion?: string };
  const system = `${systemName ?? Platform.OS} ${osVersion ?? Platform.Version}`;
  void supabase
    .rpc('report_sign_in_problem', {
      problem: `${provider} ${errorCode(error) ?? 'no code'}: ${message} (${system})`,
      device: Platform.OS,
      app_version: appVersion(),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

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
