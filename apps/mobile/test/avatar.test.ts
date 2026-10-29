import * as ImagePicker from 'expo-image-picker';

import { pickAvatar } from '@/features/profile/avatar';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@/lib/supabase', () => ({ supabase: null, requireSupabase: jest.fn() }));

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
