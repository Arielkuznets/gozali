/**
 * A name the sign-in provider gave. Apple sends the name only the first time someone signs in,
 * and not inside the token Supabase sees, so it is kept here for the profile setup screen.
 */
let suggested: string | null = null;

export function suggestName(name: string | null | undefined): void {
  suggested = name?.trim() || null;
}

export function suggestedName(): string | null {
  return suggested;
}
