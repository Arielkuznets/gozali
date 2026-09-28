import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

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
 * True when the server turned the feed down for good, as opposed to a network failure: a
 * database error has a SQLSTATE code, and storage answers with an HTTP status.
 */
export function isFinalRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && /^[0-9A-Z]{5}$/.test(String(error.code))) return true;
  return 'statusCode' in error && /^4[0-9]{2}$/.test(String(error.statusCode));
}

export function feedErrorCode(error: unknown): 'already_fed' | 'not_a_member' | 'other' {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('already_fed')) return 'already_fed';
  if (message.includes('not_a_member')) return 'not_a_member';
  return 'other';
}
