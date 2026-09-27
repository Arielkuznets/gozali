import { renderCritter } from '@gozali/critter-art';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetSnapshot } from '@/features/widgets/data';
import i18n from '@/i18n';

// Android home screen widgets (spec section 9): the critter, health, "3/5" and whether you fed.
// No photos or member names, since the home screen is visible to others.

type Pack = WidgetSnapshot['packs'][number];

const INK = '#3B2F2A';
const MUTED = '#7A6A60';
const CREAM = '#FBF6EE';
const TRACK = '#EADFD2';
const ACCENT = '#E8795A';
const HEALTH = [
  [85, '#7FB069'],
  [60, '#A9C97F'],
  [40, '#E9C46A'],
  [20, '#E8A15A'],
  [0, '#D9735F'],
] as const;

function healthColor(health: number): `#${string}` {
  return (HEALTH.find(([min]) => health >= min)?.[1] ?? '#D9735F') as `#${string}`;
}

function isNight(): boolean {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 7;
}

function critterSvg(pack: Pack): string {
  return renderCritter(isNight() ? pack.nightArt : pack.art);
}

function link(pack: Pack): string {
  return pack.iFed ? `gozali://pack/${pack.id}` : `gozali://pack/${pack.id}/feed`;
}

function timeLeft(pack: Pack): string {
  const minutes = Math.max(0, Math.round((Date.parse(pack.dayEndsAt) - Date.now()) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function HealthBar({ health, width }: { health: number; width: number }) {
  const filled = Math.round((width * health) / 100);
  return (
    <FlexWidget style={{ width, height: 8, borderRadius: 4, backgroundColor: TRACK, flexDirection: 'row' }}>
      <FlexWidget style={{ width: Math.max(filled, 1), height: 8, borderRadius: 4, backgroundColor: healthColor(health) }} />
    </FlexWidget>
  );
}

function FedLine({ pack }: { pack: Pack }) {
  return (
    <TextWidget
      text={`${pack.fed}/${pack.total}${pack.iFed ? '  ✓' : ''}`}
      style={{ fontSize: 14, color: INK, fontFamily: 'sans-serif-medium' }}
    />
  );
}

export function SignedOutWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: CREAM, borderRadius: 24, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
      <TextWidget text={i18n.t('widgets.signedOut')} style={{ fontSize: 14, color: MUTED, textAlign: 'center' }} />
    </FlexWidget>
  );
}

/** Small: one pack. */
export function PackWidget({ pack }: { pack: Pack | undefined }) {
  if (!pack) return <SignedOutWidget />;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: link(pack) }}
      accessibilityLabel={pack.label}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: CREAM, borderRadius: 24, alignItems: 'center', justifyContent: 'center', padding: 10 }}>
      <SvgWidget svg={critterSvg(pack)} style={{ width: 88, height: 88 }} />
      <HealthBar health={pack.health} width={110} />
      <FlexWidget style={{ marginTop: 6 }}>
        <FedLine pack={pack} />
      </FlexWidget>
    </FlexWidget>
  );
}

function Dots({ pack }: { pack: Pack }) {
  return (
    <FlexWidget style={{ flexDirection: 'row' }}>
      {pack.members.map((mark, index) => (
        <FlexWidget
          key={index}
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            marginRight: 4,
            backgroundColor: mark === 'fed' ? ACCENT : mark === 'away' ? TRACK : CREAM,
            borderWidth: mark === 'fed' || mark === 'away' ? 0 : 1.5,
            borderColor: MUTED,
            borderStyle: mark === 'pass' ? 'dashed' : 'solid',
          }}
        />
      ))}
    </FlexWidget>
  );
}

/** Medium: one pack with the member dots, streak, time left and a Feed button. */
export function PackWideWidget({ pack }: { pack: Pack | undefined }) {
  if (!pack) return <SignedOutWidget />;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `gozali://pack/${pack.id}` }}
      accessibilityLabel={pack.label}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: CREAM, borderRadius: 24, flexDirection: 'row', alignItems: 'center', padding: 12 }}>
      <SvgWidget svg={critterSvg(pack)} style={{ width: 104, height: 104 }} />
      <FlexWidget style={{ marginLeft: 12, flex: 1 }}>
        <TextWidget text={pack.critterName} style={{ fontSize: 16, color: INK, fontFamily: 'sans-serif-medium' }} maxLines={1} />
        <FlexWidget style={{ marginTop: 6 }}>
          <HealthBar health={pack.health} width={150} />
        </FlexWidget>
        <FlexWidget style={{ marginTop: 6 }}>
          <Dots pack={pack} />
        </FlexWidget>
        <TextWidget
          text={`🔥 ${pack.streak} · ${i18n.t('widgets.endsIn', { time: timeLeft(pack) })}`}
          style={{ fontSize: 12, color: MUTED, marginTop: 6 }}
          maxLines={1}
        />
        {!pack.iFed && (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: `gozali://pack/${pack.id}/feed` }}
            style={{ marginTop: 8, backgroundColor: ACCENT, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 6 }}>
            <TextWidget text={i18n.t('widgets.feed')} style={{ fontSize: 14, color: '#FFFFFF', fontFamily: 'sans-serif-medium' }} />
          </FlexWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}

/** Large: up to three packs. */
export function AllPacksWidget({ packs }: { packs: Pack[] | undefined }) {
  if (!packs || packs.length === 0) return <SignedOutWidget />;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: CREAM, borderRadius: 24, padding: 12 }}>
      {packs.slice(0, 3).map((pack) => (
        <FlexWidget
          key={pack.id}
          clickAction="OPEN_URI"
          clickActionData={{ uri: link(pack) }}
          accessibilityLabel={pack.label}
          style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginBottom: 8 }}>
          <SvgWidget svg={critterSvg(pack)} style={{ width: 64, height: 64 }} />
          <FlexWidget style={{ marginLeft: 10, flex: 1 }}>
            <TextWidget text={pack.name} style={{ fontSize: 15, color: INK, fontFamily: 'sans-serif-medium' }} maxLines={1} />
            <FlexWidget style={{ marginTop: 4 }}>
              <HealthBar health={pack.health} width={140} />
            </FlexWidget>
          </FlexWidget>
          <FedLine pack={pack} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}
