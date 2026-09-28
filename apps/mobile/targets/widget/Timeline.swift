import AppIntents
import UIKit
import WidgetKit

/// A pack to choose in the widget's settings (spec section 9: single-pack widgets pick a pack).
struct PackEntity: AppEntity {
  let id: String
  let name: String

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Pack"
  static let defaultQuery = PackQuery()
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct PackQuery: EntityQuery {
  private func all() -> [PackEntity] {
    (SharedStore.snapshot()?.packs ?? []).map { PackEntity(id: $0.id, name: $0.name) }
  }

  func entities(for identifiers: [PackEntity.ID]) async throws -> [PackEntity] {
    all().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [PackEntity] { all() }

  func defaultResult() async -> PackEntity? { all().first }
}

struct SelectPackIntent: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Choose a pack"
  static let description = IntentDescription("The pack this widget shows.")

  @Parameter(title: "Pack")
  var pack: PackEntity?
}

struct PackEntry: TimelineEntry {
  let date: Date
  /// Nil when signed out or before the app ran once.
  let packs: [WidgetPack]?
  let chosenId: String?
  let images: [String: UIImage]

  var pack: WidgetPack? {
    guard let packs else { return nil }
    return packs.first { $0.id == chosenId } ?? packs.first
  }

  static let placeholder = PackEntry(date: Date(), packs: nil, chosenId: nil, images: [:])
}

/// Builds the entries: now, and again when the critter falls asleep (22:00) or wakes (07:00),
/// with the matching picture. WidgetKit asks again after 30 minutes or when the pack day ends.
func buildTimeline(chosenId: String?, limit: Int?) async -> Timeline<PackEntry> {
  let now = Date()
  guard let snapshot = await WidgetAPI.currentSnapshot(now: now) else {
    return Timeline(entries: [PackEntry(date: now, packs: nil, chosenId: nil, images: [:])], policy: .after(now.addingTimeInterval(30 * 60)))
  }
  var packs = snapshot.packs
  if let chosenId, limit == 1 { packs = packs.filter { $0.id == chosenId } + packs.filter { $0.id != chosenId } }
  if let limit { packs = Array(packs.prefix(limit)) }

  let switchAt = nextSleepSwitch(after: now)
  var entries: [PackEntry] = []
  for date in [now, switchAt] {
    var images: [String: UIImage] = [:]
    for pack in packs {
      images[pack.id] = await WidgetAPI.image(isNight(date) ? pack.nightImageUrl : pack.imageUrl)
    }
    entries.append(PackEntry(date: date, packs: snapshot.packs, chosenId: chosenId, images: images))
  }

  var refresh = now.addingTimeInterval(30 * 60)
  if let dayEnd = packs.compactMap(\.dayEnd).filter({ $0 > now }).min() {
    // An hour after the day ends, the day close has run and the critter may have changed.
    refresh = min(refresh, dayEnd.addingTimeInterval(65 * 60))
  }
  return Timeline(entries: entries, policy: .after(refresh))
}

private func nextSleepSwitch(after date: Date) -> Date {
  let calendar = Calendar.current
  let candidates = [22, 7].compactMap { hour in
    calendar.nextDate(after: date, matching: DateComponents(hour: hour, minute: 0), matchingPolicy: .nextTime)
  }
  return candidates.min() ?? date.addingTimeInterval(60 * 60)
}

struct PackProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> PackEntry { .placeholder }

  func snapshot(for configuration: SelectPackIntent, in context: Context) async -> PackEntry {
    await buildTimeline(chosenId: configuration.pack?.id, limit: 1).entries.first ?? .placeholder
  }

  func timeline(for configuration: SelectPackIntent, in context: Context) async -> Timeline<PackEntry> {
    await buildTimeline(chosenId: configuration.pack?.id, limit: 1)
  }
}

struct AllPacksProvider: TimelineProvider {
  func placeholder(in context: Context) -> PackEntry { .placeholder }

  func getSnapshot(in context: Context, completion: @escaping (PackEntry) -> Void) {
    Task { completion(await buildTimeline(chosenId: nil, limit: 3).entries.first ?? .placeholder) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<PackEntry>) -> Void) {
    Task { completion(await buildTimeline(chosenId: nil, limit: 3)) }
  }
}
