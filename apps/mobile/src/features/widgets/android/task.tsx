import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { AllPacksWidget, PackWideWidget, PackWidget } from '@/features/widgets/android/widgets';
import { fetchSnapshot, loadSnapshot, saveSnapshot, widgetToken, type WidgetSnapshot } from '@/features/widgets/data';

export const ANDROID_WIDGETS = ['PackSmall', 'PackMedium', 'AllPacks'] as const;
type WidgetName = (typeof ANDROID_WIDGETS)[number];

/** How old the snapshot may be before a widget refresh fetches a new one. */
const FRESH_MS = 25 * 60_000;
const choiceKey = (widgetId: number) => `gozali.widget-pack.${widgetId}`;

export async function choosePack(widgetId: number, packId: string): Promise<void> {
  await AsyncStorage.setItem(choiceKey(widgetId), packId);
}

async function packFor(snapshot: WidgetSnapshot | null, widgetId: number) {
  if (!snapshot) return undefined;
  const chosen = await AsyncStorage.getItem(choiceKey(widgetId));
  return snapshot.packs.find((pack) => pack.id === chosen) ?? snapshot.packs[0];
}

export async function renderFor(name: string, widgetId: number, snapshot: WidgetSnapshot | null) {
  switch (name as WidgetName) {
    case 'PackMedium':
      return <PackWideWidget pack={await packFor(snapshot, widgetId)} />;
    case 'AllPacks':
      return <AllPacksWidget packs={snapshot?.packs} />;
    default:
      return <PackWidget pack={await packFor(snapshot, widgetId)} />;
  }
}

/** The latest snapshot: the saved one if fresh, otherwise fetched with the device's token. */
async function currentSnapshot(): Promise<WidgetSnapshot | null> {
  const saved = await loadSnapshot();
  if (saved && Date.now() - Date.parse(saved.fetchedAt) < FRESH_MS) return saved;
  const token = await widgetToken(false);
  const fresh = token ? await fetchSnapshot(token) : null;
  if (fresh) await saveSnapshot(fresh);
  return fresh ?? saved;
}

/** Runs in the background when Android adds, updates (every 30 minutes) or resizes a widget. */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') {
    await AsyncStorage.removeItem(choiceKey(widgetInfo.widgetId));
    return;
  }
  if (widgetAction === 'WIDGET_CLICK') return;
  renderWidget(await renderFor(widgetInfo.widgetName, widgetInfo.widgetId, await currentSnapshot()));
}

/** Redraws every widget on the home screen from a snapshot the app just saved. */
export async function updateAndroidWidgets(snapshot: WidgetSnapshot | null): Promise<void> {
  for (const widgetName of ANDROID_WIDGETS) {
    await requestWidgetUpdate({
      widgetName,
      renderWidget: (info) => renderFor(widgetName, info.widgetId, snapshot),
    });
  }
}
