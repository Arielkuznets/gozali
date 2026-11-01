import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { errorMessage } from '@/lib/errors';
import { requireSupabase } from '@/lib/supabase';

export const PHOTO_BUCKET = 'feed-photos';
const MAX_WIDTH = 1080;
const JPEG_QUALITY = 0.7;

/** A feed waiting to be sent: the compressed photo on the device plus what goes with it. */
export type OutgoingFeed = {
  id: string;
  packId: string;
  userId: string;
  photoUri: string;
  caption: string | null;
  capturedAt: string;
  focusMinutes: number | null;
  extra: boolean;
};

/** Shrinks a camera photo to at most 1080px wide, JPEG at quality 0.7 (spec section 6). */
export async function compressPhoto(uri: string, width: number): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return saved.uri;
}

async function photoBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

/**
 * Uploads the photo and saves the feed. The upload path is named after the feed's local id,
 * so a retry after a lost response overwrites nothing and finds the photo already there.
 */
export async function sendFeed(feed: OutgoingFeed): Promise<string> {
  const supabase = requireSupabase();
  // Back online after the access token expired, a refresh that fails leaves no session, and the
  // requests go out signed out, which the server refuses as if for good. This error is not final,
  // so the feed waits for the next try.
  if (!(await supabase.auth.getSession()).data.session) throw new Error('not_signed_in');
  const path = `${feed.packId}/${feed.userId}/${feed.id}.jpg`;
  const upload = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, await photoBytes(feed.photoUri), { contentType: 'image/jpeg' });
  if (upload.error && !isAlreadyUploaded(upload.error)) throw upload.error;

  const { data, error } = await supabase.rpc('submit_feed', {
    target: feed.packId,
    photo: path,
    note: feed.caption ?? undefined,
    taken_at: feed.capturedAt,
    focus: feed.focusMinutes ?? undefined,
    extra: feed.extra,
  });
  if (error) {
    // Turned down for good (for example a blocked word): don't leave the file behind.
    if (isFinalRejection(error)) await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
  return data;
}

function isAlreadyUploaded(error: object): boolean {
  const conflict = 'statusCode' in error && String(error.statusCode) === '409';
  return conflict || ('message' in error && String(error.message).includes('already exists'));
}

/**
 * True when this feed can never pass: a queued feed that gets this answer is dropped with its only
 * photo, so anything else waits. The database refuses with a raised error, bad data, a broken
 * constraint or a missing privilege (SQLSTATE); storage refuses with row-level security, or a
 * missing bucket or a file it won't take. A timeout, a lock or an expired token passes on a later
 * try, and storage answers that last one with a 403 too.
 */
export function isFinalRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && /^(P0[0-9A-Z]{3}|2[23][0-9A-Z]{3}|42501)$/.test(String(error.code))) return true;
  if (!('statusCode' in error)) return false;
  const status = String(error.statusCode);
  if (status === '403') return 'message' in error && String(error.message).includes('row-level security');
  return status === '404' || status === '413' || status === '415';
}

/**
 * True when the server gave no answer: supabase-js hands a failed request back with an empty code,
 * and storage as its "unknown" error. Without a session the refresh failed the same way.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('name' in error && error.name === 'StorageUnknownError') return true;
  return ('code' in error && error.code === '') || errorMessage(error) === 'not_signed_in';
}

export function feedErrorCode(error: unknown): 'already_fed' | 'not_a_member' | 'other' {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('already_fed')) return 'already_fed';
  if (message.includes('not_a_member')) return 'not_a_member';
  return 'other';
}
