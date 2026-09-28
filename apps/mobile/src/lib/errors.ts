/** The error code a server function raised, from a Supabase error or anything thrown. */
export function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
}

/** Text the word filter turned down (spec section 11). */
export function isBlockedText(error: unknown): boolean {
  return errorMessage(error).includes('text_not_allowed');
}
