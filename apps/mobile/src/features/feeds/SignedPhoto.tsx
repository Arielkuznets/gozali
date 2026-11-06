import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';

type Props = Omit<ImageProps, 'source' | 'onLoad'> & { id: string; url: string };

/**
 * A stored photo behind a signed link. Every read brings a new link: a photo that has loaded stays on
 * the link it loaded with, or it would load from the disk again and fade in over itself. One that
 * hasn't takes the new link, which is how a failed one tries again.
 *
 * The server limits a photo's bytes, not its pixels, and iOS would decode it at its full size before
 * shrinking it: a member can post one with more pixels than a phone has memory for.
 */
export function SignedPhoto({ id, url, ...image }: Props) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  return (
    <Image
      {...image}
      enforceEarlyResizing
      source={{ uri: loadedUrl ?? url, cacheKey: id }}
      onLoad={() => setLoadedUrl((loaded) => loaded ?? url)}
    />
  );
}
