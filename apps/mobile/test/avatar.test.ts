import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { pickAvatar, useSetAvatar } from '@/features/profile/avatar';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: () => undefined,
      renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///small.jpg' }) }),
    }),
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    arrayBuffer = async () => new ArrayBuffer(1);
  },
}));

// The server as the phone can see it: the profile's photo and the files in the member's folder.
// An update can be answered, refused, lost on the way there, or saved with its answer lost.
let mockServer: { avatarPath: string | null; files: Set<string> };
let mockUpdate: 'answered' | 'refused' | 'unsent' | 'lost';
let mockRemoveFails: boolean;
jest.mock('@/lib/supabase', () => {
  const noAnswer = { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
  return {
    supabase: null,
    requireSupabase: () => ({
      storage: {
        from: () => ({
          upload: async (path: string) => {
            mockServer.files.add(path);
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            if (mockRemoveFails) return { data: null, error: new Error('Network request failed') };
            for (const path of paths) mockServer.files.delete(path);
            return { data: [], error: null };
          },
        }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { avatar_path: mockServer.avatarPath }, error: null }) }) }),
        update: ({ avatar_path }: { avatar_path: string | null }) => ({
          eq: async () => {
            if (mockUpdate === 'refused') return { data: null, error: { message: 'violates check constraint', code: '23514' } };
            if (mockUpdate === 'unsent') return noAnswer;
            mockServer.avatarPath = avatar_path;
            return mockUpdate === 'lost' ? noAnswer : { data: null, error: null };
          },
        }),
      }),
    }),
  };
});
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'ana' } } }) }));
jest.mock('@/features/profile/useProfile', () => ({ useProfile: () => ({ data: { avatar_path: 'ana/1.jpg' } }) }));
const mockReport = jest.fn();
jest.mock('@/lib/reportError', () => ({ reportError: (error: unknown) => mockReport(error) }));

const picker = jest.mocked(ImagePicker);

describe('picking a profile photo', () => {
  it('says the camera is off for the app, rather than acting as if nothing was picked', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as ImagePicker.CameraPermissionResponse);
    await expect(pickAvatar('camera')).rejects.toThrow('camera_blocked');
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('gives nothing back when the member closes the picker', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAvatar('library')).resolves.toBeNull();
  });
});

describe('saving a profile photo', () => {
  let setAvatar: ReturnType<typeof useSetAvatar>;
  function Harness() {
    const mutation = useSetAvatar();
    useEffect(() => {
      setAvatar = mutation;
    });
    return null;
  }

  let screen: ReactTestRenderer;
  beforeEach(async () => {
    mockServer = { avatarPath: 'ana/1.jpg', files: new Set(['ana/1.jpg']) };
    mockUpdate = 'answered';
    mockRemoveFails = false;
    mockReport.mockReset();
    await act(async () => {
      const client = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
      screen = create(createElement(QueryClientProvider, { client }, createElement(Harness)));
    });
  });

  afterEach(async () => {
    await act(async () => screen.unmount());
  });

  /** 'saved', or what the save threw. */
  async function save(uri: string | null): Promise<unknown> {
    let outcome: unknown = 'saved';
    await act(async () => {
      await setAvatar.mutateAsync(uri).catch((error: unknown) => {
        outcome = error;
      });
    });
    return outcome;
  }

  const files = () => [...mockServer.files];

  it('replaces the old photo', async () => {
    expect(await save('file:///picked.jpg')).toBe('saved');
    expect(mockServer.avatarPath).toMatch(/^ana\/\d+\.jpg$/);
    expect(files()).toEqual([mockServer.avatarPath]);
  });

  it('keeps a new photo the server saved when the answer is lost, and removes the old one', async () => {
    mockUpdate = 'lost';

    expect(await save('file:///picked.jpg')).toBe('saved');

    expect(mockServer.avatarPath).toMatch(/^ana\/\d+\.jpg$/);
    expect(files()).toEqual([mockServer.avatarPath]);
  });

  it('removes the old file when the answer to Remove photo is lost', async () => {
    mockUpdate = 'lost';

    expect(await save(null)).toBe('saved');

    expect(mockServer.avatarPath).toBeNull();
    expect(files()).toEqual([]);
  });

  it('takes the new file back when the server refuses', async () => {
    mockUpdate = 'refused';

    expect(await save('file:///picked.jpg')).toMatchObject({ code: '23514' });

    expect(mockServer.avatarPath).toBe('ana/1.jpg');
    expect(files()).toEqual(['ana/1.jpg']);
  });

  it('fails and leaves the new file when nothing came back and the profile is as it was, as the update may still land', async () => {
    mockUpdate = 'unsent';

    expect(await save('file:///picked.jpg')).toMatchObject({ code: '' });

    expect(mockServer.avatarPath).toBe('ana/1.jpg');
    expect(files()).toEqual(['ana/1.jpg', expect.stringMatching(/^ana\/\d+\.jpg$/)]);
  });

  it('reports an old file it could not remove, and the new photo stays', async () => {
    mockRemoveFails = true;

    expect(await save('file:///picked.jpg')).toBe('saved');

    expect(mockServer.avatarPath).toMatch(/^ana\/\d+\.jpg$/);
    expect(mockReport).toHaveBeenCalledTimes(1);
  });
});
