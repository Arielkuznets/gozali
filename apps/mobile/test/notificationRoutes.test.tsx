import { act, create } from 'react-test-renderer';

import { useNotificationRoutes } from '@/lib/notifications';

type Tap = { notification: { request: { content: { data: { url: string } } } } };
const tap = (url: string): Tap => ({ notification: { request: { content: { data: { url } } } } });

let mockListener: ((response: Tap) => void) | null = null;
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponseAsync: async () => undefined,
  addNotificationResponseReceivedListener: (listener: (response: Tap) => void) => {
    mockListener = listener;
    return { remove: () => undefined };
  },
}));
const mockPush = jest.fn();
let mockPathname = '/pack/p1';
jest.mock('expo-router', () => ({ router: { push: (url: string) => mockPush(url) }, usePathname: () => mockPathname }));
jest.mock('@/lib/push', () => ({ registerPushToken: async () => undefined }));

function Routes() {
  useNotificationRoutes();
  return null;
}

describe('tapping a notification', () => {
  it("opens its screen, but doesn't stack a second copy of the one already open", async () => {
    await act(async () => {
      create(<Routes />);
    });
    mockListener?.(tap('/pack/p1'));
    expect(mockPush).not.toHaveBeenCalled();
    mockListener?.(tap('/pack/p2'));
    expect(mockPush).toHaveBeenCalledWith('/pack/p2');
  });

  it('knows the open camera from the focus-end notice, whose link carries a query', async () => {
    mockPathname = '/pack/p1/feed';
    mockPush.mockClear();
    await act(async () => {
      create(<Routes />);
    });
    mockListener?.(tap('/pack/p1/feed?focus=25'));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
