import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { MemberCircles } from '@/components/MemberCircles';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/features/profile/avatar', () => ({ avatarCacheKey: (url: string) => url }));

const noa = { id: 'noa', name: 'Noa', state: 'waiting' as const, self: true };
const dan = { id: 'dan', name: 'Dan', state: 'fed' as const };

function render(members: Parameters<typeof MemberCircles>[0]['members'], onMenu = jest.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<MemberCircles members={members} color="#E8795A" onNudge={jest.fn()} onMenu={onMenu} />);
  });
  return tree;
}

/** The circles a screen reader announces as buttons, by their labels. */
const buttonLabels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button')
    .map((node) => node.props.accessibilityLabel);

const circle = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((node) => typeof node.type === 'string' && node.props.accessibilityLabel === label);

/** A click the way a screen reader sends one: not from a pointer, aimed at the circle itself. */
const click = (node: ReactTestInstance) => ({ nativeEvent: {}, currentTarget: node, target: node, stopPropagation: () => undefined });

describe("the member's own circle", () => {
  it("is no button and takes no touch, beside a friend's circle that opens their menu", () => {
    const onMenu = jest.fn();
    const tree = render([noa, dan], onMenu);

    expect(buttonLabels(tree)).toEqual(['Dan, fed today']);

    const own = circle(tree, 'Noa, not yet today');
    expect(own.props.onStartShouldSetResponder()).toBe(false);
    act(() => own.props.onClick(click(own)));
    expect(onMenu).not.toHaveBeenCalled();

    const friend = circle(tree, 'Dan, fed today');
    act(() => friend.props.onClick(click(friend)));
    expect(onMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'dan' }));
  });
});
