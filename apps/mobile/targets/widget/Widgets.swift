import SwiftUI
import WidgetKit

struct PackWidget: Widget {
  let kind = "PackWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: SelectPackIntent.self, provider: PackProvider()) { entry in
      PackWidgetView(entry: entry)
    }
    .configurationDisplayName("Pack")
    .description("Your pet, its health and who fed today.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
  }
}

struct AllPacksWidget: Widget {
  let kind = "AllPacksWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AllPacksProvider()) { entry in
      AllPacksWidgetView(entry: entry)
    }
    .configurationDisplayName("All packs")
    .description("Up to three packs at a glance.")
    .supportedFamilies([.systemLarge])
  }
}

@main
struct GozaliWidgets: WidgetBundle {
  var body: some Widget {
    PackWidget()
    AllPacksWidget()
  }
}
