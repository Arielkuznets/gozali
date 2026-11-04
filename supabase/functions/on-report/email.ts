// What the developer reads about a report: on a photo, or on a member for their name or profile photo.

export type Details = {
  reportId: string;
  reason: string | null;
  reportedAt: string;
  reporter: { id: string; name: string | null };
  /** Who posted the photo, or the member reported. */
  author: { id: string; name: string | null; avatarPath?: string | null };
  /** Null for a report on a member. */
  feed: { id: string; caption: string | null; photoPath: string | null; hidden: boolean; postedAt: string; packId: string } | null;
  reports: number;
};

/** The picture a report is about, as the bucket and path it is stored at. */
export function reportedPicture({ feed, author }: Details): { bucket: string; path: string } | null {
  if (feed) return feed.photoPath ? { bucket: 'feed-photos', path: feed.photoPath } : null;
  return author.avatarPath ? { bucket: 'avatars', path: author.avatarPath } : null;
}

/**
 * The subject and the lines of the email; `link` opens the picture, and is empty without one or
 * when Storage couldn't sign it, as `linkFailure` then says.
 */
export function reportEmail(details: Details, link: string, linkFailure?: string): { subject: string; lines: string[] } {
  const { author, feed, reports } = details;
  const reported = `${author.name ?? '?'} (${author.id})`;
  const shown = link || (linkFailure ? `(the link failed: ${linkFailure})` : '(no photo)');
  const about = feed
    ? [
        `Posted by: ${reported} at ${feed.postedAt}`,
        `Caption: ${feed.caption ?? '(none)'}`,
        `Photo (link valid 7 days): ${shown}`,
      ]
    : [`Member: ${reported}`, `Profile photo (link valid 7 days): ${shown}`];
  // Either way the photo's reports are marked handled, so only new reports can hide it again.
  const remedies = feed
    ? [
        `Keep it: update public.reports set handled_at = now() where feed_id = '${feed.id}'; update public.feeds set hidden_at = null where id = '${feed.id}';`,
        `Hide: update public.feeds set hidden_at = now() where id = '${feed.id}'; update public.reports set handled_at = now() where feed_id = '${feed.id}';`,
      ]
    : [
        // Without a name the app sends them back to profile setup to choose another.
        `Clear the name: update public.profiles set display_name = null where id = '${author.id}';`,
        `Clear the photo: update public.profiles set avatar_path = null where id = '${author.id}';`,
      ];
  return {
    subject: `Gozali report: ${feed ? (feed.caption ?? 'a photo') : (author.name ?? 'a member')} (${reports})`,
    lines: [
      `Report ${details.reportId} (${reports} on this ${feed ? 'item' : 'member'}${feed?.hidden ? ', now hidden' : ''})`,
      `Reason: ${details.reason ?? '(none given)'}`,
      `Reported by: ${details.reporter.name ?? '?'} (${details.reporter.id})`,
      ...about,
      '',
      ...remedies,
      `Remove the member: delete their account from the Auth dashboard (${author.id}).`,
    ],
  };
}
