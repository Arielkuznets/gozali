import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { MemberCircles } from '@/components/MemberCircles';
import { colors, critterAccents } from '@/theme/tokens';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/features/profile/avatar', () => ({ avatarCacheKey: (url: string) => url }));

// Spec section 10: text reads at 4.5:1 or more (WCAG AA), which WCAG doesn't round.
const AA = 4.5;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** The color of the initial on a fed circle without a photo, filled with `fill`. */
function fedInitialColor(fill: string): string {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<MemberCircles members={[{ id: 'dan', name: 'Dan', state: 'fed' }]} color={fill} />);
  });
  const initial = tree.root.find((node) => node.type === 'Text' && node.props.children === 'D');
  return StyleSheet.flatten(initial.props.style).color as string;
}

describe('text on the accent', () => {
  it('reads at 4.5:1 or more on the buttons', () => {
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(AA);
  });

  it.each(Object.entries({ ...critterAccents, 'the plain accent': colors.accent }))(
    "reads at 4.5:1 or more as a fed member's initial on %s",
    (_, fill) => {
      expect(contrast(fedInitialColor(fill), fill)).toBeGreaterThanOrEqual(AA);
    },
  );
});
