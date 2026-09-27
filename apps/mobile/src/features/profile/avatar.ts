import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { useProfile } from '@/features/profile/useProfile';
import { requireSupabase } from '@/lib/supabase';

// The optional profile photo (spec section 9). Unlike feeds, it may come from the gallery: it
// proves nothing. Stored small and private; pack mates see it through signed links.
const BUCKET = 'avatars';
const SIZE = 256;
const LINK_SECONDS = 60 * 60;

/** Lets the member take or pick a square photo; null when they cancel. */
export async function pickAvatar(source: 'camera' | 'library'): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

async function bytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

export function useSetAvatar() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const profile = useProfile();
  return useMutation({
    /** A new photo, or null to remove the current one. */
    mutationFn: async (uri: string | null) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('Not signed in');
      const supabase = requireSupabase();
      let path: string | null = null;
      if (uri) {
        const context = ImageManipulator.manipulate(uri);
        context.resize({ width: SIZE, height: SIZE });
        const image = await (await context.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
        // A new name each time, so cached copies of the old photo don't linger.
        path = `${userId}/${Date.now()}.jpg`;
        const upload = await supabase.storage.from(BUCKET).upload(path, await bytes(image.uri), { contentType: 'image/jpeg' });
        if (upload.error) throw upload.error;
      }
      const previous = profile.data?.avatar_path ?? null;
      const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
      if (error) throw error;
      if (previous) await supabase.storage.from(BUCKET).remove([previous]);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['packs'] });
    },
  });
}

/** Signed links for a set of avatar paths, by path. */
export function useAvatarUrls(paths: readonly (string | null | undefined)[]) {
  const wanted = [...new Set(paths.filter((path): path is string => Boolean(path)))].sort();
  return useQuery({
    queryKey: ['avatars', wanted.join()],
    enabled: wanted.length > 0,
    staleTime: (LINK_SECONDS / 2) * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await requireSupabase().storage.from(BUCKET).createSignedUrls(wanted, LINK_SECONDS);
      if (error) throw error;
      return new Map(data.flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [])));
    },
  });
}
