import CryptoKit
import Foundation
import UIKit

/// Shared with the app through the App Group; must match app.json and src/features/widgets/data.ts.
let appGroup = "group.app.gozali"

/// What the widget-state endpoint returns. Unknown keys (the drawing input the Android widget
/// uses) are ignored by the decoder.
struct WidgetSnapshot: Codable {
  let timezone: String
  let fetchedAt: String
  let packs: [WidgetPack]
}

struct WidgetPack: Codable, Identifiable {
  let id: String
  let name: String
  let critterName: String
  let health: Int
  let status: String
  let streak: Int
  let fed: Int
  let total: Int
  let iFed: Bool
  let members: [String]
  let dayEndsAt: String
  let label: String
  let imageUrl: String
  let nightImageUrl: String

  var packURL: URL { URL(string: "gozali://pack/\(id)")! }
  var feedURL: URL { URL(string: "gozali://pack/\(id)/feed")! }
  /// Tapping opens the camera until you fed today, then the pack.
  var tapURL: URL { iFed ? packURL : feedURL }

  var dayEnd: Date? { isoDate(dayEndsAt) }
}

func isoDate(_ text: String) -> Date? {
  let withFraction = ISO8601DateFormatter()
  withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}

/// Night on the device clock (22:00-07:00), when the critter sleeps, as in the app.
func isNight(_ date: Date) -> Bool {
  let hour = Calendar.current.component(.hour, from: date)
  return hour >= 22 || hour < 7
}

enum SharedStore {
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  /// The app writes the snapshot, the device's widget token and the endpoint after each action.
  static func snapshot() -> WidgetSnapshot? {
    guard let text = defaults?.string(forKey: "snapshot"), let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }

  static func save(_ snapshot: WidgetSnapshot) {
    guard let data = try? JSONEncoder().encode(snapshot), let text = String(data: data, encoding: .utf8) else { return }
    defaults?.set(text, forKey: "snapshot")
  }

  static var token: String? { defaults?.string(forKey: "token") }
  static var endpoint: URL? { defaults?.string(forKey: "endpoint").flatMap(URL.init(string:)) }
}

enum WidgetAPI {
  /// A snapshot no older than 25 minutes: the saved one, or a fresh one from the server.
  static func currentSnapshot(now: Date) async -> WidgetSnapshot? {
    let saved = SharedStore.snapshot()
    if let saved, let fetched = isoDate(saved.fetchedAt), now.timeIntervalSince(fetched) < 25 * 60 {
      return saved
    }
    guard let fresh = await fetchSnapshot() else { return saved }
    SharedStore.save(fresh)
    return fresh
  }

  static func fetchSnapshot() async -> WidgetSnapshot? {
    guard let request = request(for: SharedStore.endpoint) else { return nil }
    guard let result = try? await URLSession.shared.data(for: request),
      (result.1 as? HTTPURLResponse)?.statusCode == 200
    else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: result.0)
  }

  /// The critter picture for a pack, cached by address: the address changes when the drawing does.
  static func image(_ relative: String) async -> UIImage? {
    guard let endpoint = SharedStore.endpoint, let url = URL(string: relative, relativeTo: endpoint) else { return nil }
    let file = cacheFile(for: url.absoluteString)
    if let file, let cached = UIImage(contentsOfFile: file.path) { return cached }
    guard let request = request(for: url),
      let result = try? await URLSession.shared.data(for: request),
      (result.1 as? HTTPURLResponse)?.statusCode == 200,
      let image = UIImage(data: result.0)
    else { return nil }
    if let file { try? result.0.write(to: file) }
    return image
  }

  private static func request(for url: URL?) -> URLRequest? {
    guard let url, let token = SharedStore.token else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = 15
    request.setValue(token, forHTTPHeaderField: "x-widget-token")
    return request
  }

  private static func cacheFile(for address: String) -> URL? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      return nil
    }
    let folder = container.appendingPathComponent("widget-images", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let name = SHA256.hash(data: Data(address.utf8)).map { String(format: "%02x", $0) }.joined()
    return folder.appendingPathComponent("\(name).png")
  }
}
