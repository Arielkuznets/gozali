import SwiftUI
import WidgetKit

// Widget layouts (spec section 9): the critter, health, "3/5" and whether you fed. No photos
// and no member names, since the home screen and the lock screen are visible to others.

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }

  static let cream = Color(hex: 0xFBF6EE)
  static let ink = Color(hex: 0x3B2F2A)
  static let muted = Color(hex: 0x7A6A60)
  static let track = Color(hex: 0xEADFD2)
  static let accent = Color(hex: 0xE8795A)

  static func health(_ value: Int) -> Color {
    switch value {
    case 85...: return Color(hex: 0x7FB069)
    case 60...: return Color(hex: 0xA9C97F)
    case 40...: return Color(hex: 0xE9C46A)
    case 20...: return Color(hex: 0xE8A15A)
    default: return Color(hex: 0xD9735F)
    }
  }
}

enum Texts {
  static let signedOut = "Open Gozali to see your pack"
  static let feed = "Feed"
  static func fed(_ pack: WidgetPack) -> String { "\(pack.fed)/\(pack.total)" }
  static func endsIn(_ date: Date?) -> String {
    guard let date else { return "" }
    let minutes = max(0, Int(date.timeIntervalSinceNow / 60))
    return minutes >= 60 ? "ends in \(minutes / 60)h \(minutes % 60)m" : "ends in \(minutes)m"
  }
}

struct HealthBar: View {
  let health: Int

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.track)
        Capsule().fill(Color.health(health)).frame(width: geometry.size.width * CGFloat(health) / 100)
      }
    }
    .frame(height: 7)
    .accessibilityHidden(true)
  }
}

struct CritterImage: View {
  let pack: WidgetPack
  let image: UIImage?

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFit()
      } else {
        Circle().fill(Color.track)
      }
    }
    .accessibilityLabel(pack.label)
  }
}

struct MemberDots: View {
  let marks: [String]

  var body: some View {
    HStack(spacing: 4) {
      ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in
        Circle()
          .fill(mark == "fed" ? Color.accent : mark == "away" ? Color.track : Color.cream)
          .overlay(
            Circle().strokeBorder(
              Color.muted,
              style: StrokeStyle(lineWidth: mark == "fed" || mark == "away" ? 0 : 1.5, dash: mark == "pass" ? [2, 2] : [])
            )
          )
          .frame(width: 12, height: 12)
      }
    }
    .accessibilityHidden(true)
  }
}

struct SignedOutView: View {
  var body: some View {
    Text(Texts.signedOut)
      .font(.footnote)
      .foregroundStyle(Color.muted)
      .multilineTextAlignment(.center)
  }
}

struct SmallPackView: View {
  let pack: WidgetPack
  let image: UIImage?

  var body: some View {
    VStack(spacing: 6) {
      CritterImage(pack: pack, image: image).frame(maxHeight: 80)
      HealthBar(health: pack.health)
      HStack(spacing: 4) {
        Text(Texts.fed(pack)).font(.subheadline.weight(.semibold))
        if pack.iFed { Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accent) }
      }
      .foregroundStyle(Color.ink)
    }
    .widgetURL(pack.tapURL)
  }
}

struct MediumPackView: View {
  let pack: WidgetPack
  let image: UIImage?

  var body: some View {
    HStack(spacing: 12) {
      CritterImage(pack: pack, image: image).frame(width: 110)
      VStack(alignment: .leading, spacing: 6) {
        Text(pack.critterName).font(.headline).foregroundStyle(Color.ink).lineLimit(1)
        HealthBar(health: pack.health)
        MemberDots(marks: pack.members)
        Text("🔥 \(pack.streak) · \(Texts.endsIn(pack.dayEnd))").font(.caption).foregroundStyle(Color.muted).lineLimit(1)
        if !pack.iFed {
          Link(destination: pack.feedURL) {
            Text(Texts.feed)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.white)
              .padding(.horizontal, 14)
              .padding(.vertical, 5)
              .background(Capsule().fill(Color.accent))
          }
        }
      }
    }
    .widgetURL(pack.packURL)
  }
}

struct LargePacksView: View {
  let packs: [WidgetPack]
  let images: [String: UIImage]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(packs.prefix(3)) { pack in
        Link(destination: pack.tapURL) {
          HStack(spacing: 10) {
            CritterImage(pack: pack, image: images[pack.id]).frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: 4) {
              Text(pack.name).font(.headline).foregroundStyle(Color.ink).lineLimit(1)
              HealthBar(health: pack.health)
            }
            Text(Texts.fed(pack)).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

/// Lock screen: a health ring with "3/5"; the rectangular one adds the critter's name.
struct LockScreenView: View {
  let pack: WidgetPack
  let rectangular: Bool

  var ring: some View {
    Gauge(value: Double(pack.health), in: 0...100) {
      EmptyView()
    } currentValueLabel: {
      Text(Texts.fed(pack))
    }
    .gaugeStyle(.accessoryCircularCapacity)
  }

  var body: some View {
    Group {
      if rectangular {
        HStack(spacing: 8) {
          ring
          VStack(alignment: .leading) {
            Text(pack.critterName).font(.headline).lineLimit(1)
            Text(pack.iFed ? "\(Texts.fed(pack)) ✓" : Texts.fed(pack)).font(.caption)
          }
        }
      } else {
        ring
      }
    }
    .accessibilityLabel(pack.label)
    .widgetURL(pack.packURL)
  }
}

struct PackWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: PackEntry

  var body: some View {
    Group {
      if let pack = entry.pack {
        switch family {
        case .accessoryCircular: LockScreenView(pack: pack, rectangular: false)
        case .accessoryRectangular: LockScreenView(pack: pack, rectangular: true)
        case .systemMedium: MediumPackView(pack: pack, image: entry.images[pack.id])
        default: SmallPackView(pack: pack, image: entry.images[pack.id])
        }
      } else {
        SignedOutView()
      }
    }
    .containerBackground(Color.cream, for: .widget)
  }
}

struct AllPacksWidgetView: View {
  let entry: PackEntry

  var body: some View {
    Group {
      if let packs = entry.packs, !packs.isEmpty {
        LargePacksView(packs: packs, images: entry.images)
      } else {
        SignedOutView()
      }
    }
    .containerBackground(Color.cream, for: .widget)
  }
}
