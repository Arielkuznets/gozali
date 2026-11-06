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
  /// When this phone got it, in milliseconds by its own clock: the only clock its age can be read
  /// from, as fetchedAt is the server's. A copy from before this was noted has none.
  var savedAt: Double?
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

/// Night on the device clock (22:00-07:00), when the critter sleeps. The app goes by the server's
/// clock, which a widget doesn't know.
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

  /// Leaves the widgets blank until the app writes a new token.
  static func forget() {
    defaults?.removeObject(forKey: "snapshot")
    defaults?.removeObject(forKey: "token")
  }
}

enum WidgetAPI {
  /// A snapshot no older than 25 minutes: the saved one, or a fresh one from the server. An age
  /// below zero says the clock was set back since, so it says nothing about the snapshot. A fetch
  /// that fails leaves the saved one, unless it found the token unknown and took the snapshot with it.
  static func currentSnapshot(now: Date) async -> WidgetSnapshot? {
    let saved = SharedStore.snapshot()
    if let saved, let savedAt = saved.savedAt {
      let age = now.timeIntervalSince1970 - savedAt / 1000
      if age >= 0, age < 25 * 60 { return saved }
    }
    guard let fresh = await fetchSnapshot() else { return SharedStore.snapshot() }
    SharedStore.save(fresh)
    return fresh
  }

  /// The server forgets a token nobody used for 90 days, and an account's tokens go with the
  /// account, which another phone can delete. The widgets then forget the token and the snapshot:
  /// kept, the snapshot stayed on the screen for good, and the token was tried every 30 minutes.
  static func fetchSnapshot() async -> WidgetSnapshot? {
    guard let request = request(for: SharedStore.endpoint),
      let result = try? await URLSession.shared.data(for: request)
    else { return nil }
    let status = (result.1 as? HTTPURLResponse)?.statusCode
    if status == 401, String(data: result.0, encoding: .utf8) == "unknown token" {
      SharedStore.forget()
      return nil
    }
    guard status == 200, var snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: result.0) else { return nil }
    snapshot.savedAt = Date().timeIntervalSince1970 * 1000
    return snapshot
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
