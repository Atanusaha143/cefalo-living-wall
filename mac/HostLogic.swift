import CoreGraphics
import Foundation

/// Every reason the wall may not draw, kept apart: waking the display behind the lock
/// screen must not start the wall while the screen is still locked. Low Power Mode is
/// tracked for diagnostics but does not stop the wall (the user's choice).
struct PowerState: Equatable {
  var lowPower = false
  var locked = false
  var screensAsleep = false
  var sessionInactive = false
  /// The screen saver is playing over the wall: rendering underneath would only cost power.
  var saverRunning = false
  var still: Bool { locked || screensAsleep || sessionInactive || saverRunning }
}

/// The menu's first line: why the wall is doing what it does.
func statusLine(failed: Bool, power: PowerState, paused: Bool, rate: Int) -> String {
  failed ? "Scene failed to load"
    : paused ? "Paused"
    : power.locked ? "Stopped — screen locked"
    : power.saverRunning ? "Stopped — screen saver"
    : power.screensAsleep || power.sessionInactive ? "Stopped — screen asleep"
    : rate == 0 ? "Stopped — covered by windows"
    : "Running · \(rate) fps"
}

/// The desktop pictures to remember (screen ID → URL string) before showing the still:
/// what was saved before stays, none of our own stills is ever recorded, and a screen whose
/// picture cannot be read is skipped.
func picturesToSave(current: [String: URL?], saved: [String: String], ours: [URL]) -> [String: String] {
  let ourPaths = Set(ours.map { $0.standardizedFileURL.path })
  var out = saved
  for (id, url) in current {
    guard out[id] == nil, let url, !ourPaths.contains(url.standardizedFileURL.path) else { continue }
    out[id] = url.absoluteString
  }
  return out
}

/// What to put back on each screen: its own saved picture, or, when its ID has changed
/// since install (external displays can), the first saved picture whose file still exists.
func picturesToRestore(screens: [String], saved: [String: String], exists: (URL) -> Bool) -> [String: URL] {
  let usable = saved.compactMapValues { URL(string: $0) }.filter { exists($0.value) }
  let fallback = usable.sorted { $0.key < $1.key }.first?.value
  var out: [String: URL] = [:]
  for id in screens { if let url = usable[id] ?? fallback { out[id] = url } }
  return out
}

/// The Motion menu's levels, as in scene/src/motion.js. They keep the numbers the five-level
/// versions stored (Calm 1 … Wild 5), so saved choices need no migration.
let motionLevels: [(level: Int, name: String)] = [(3, "Gentle"), (4, "Lively"), (5, "Wild")]

/// The Motion level to use: the stored choice clamped to 3…5 (an old Calm or Gentle reads as
/// Gentle), or Lively (4) until the user picks one.
func motionLevel(stored: Int?) -> Int {
  guard let stored else { return 4 }
  return min(motionLevels[motionLevels.count - 1].level, max(motionLevels[0].level, stored))
}

/// Whether to offer, once, to open Screen Saver settings.
func shouldOfferScreenSaver(alreadyShown: Bool, saverInstalled: Bool) -> Bool {
  !alreadyShown && saverInstalled
}

/// Whether a screen-saver view should draw. macOS 26 keeps pre-warmed copies of the selected
/// saver and gives no reliable "this copy is on screen" signal, so every copy draws exactly
/// while the system reports a screen-saver session, or while the screen is locked: a lock is
/// no session, yet the lock screen shows the saver. Never while the displays sleep. Thumbnails
/// in System Settings always draw, and so does a saver shown outside macOS's legacyScreenSaver
/// host (e.g. `--check-saver`).
func saverShouldRun(isPreview: Bool, sessionRunning: Bool, locked: Bool, screensAsleep: Bool, inHost: Bool) -> Bool {
  isPreview || !inHost || ((sessionRunning || locked) && !screensAsleep)
}

/// Where the whole wall sits in a view (AppKit coordinates, y up) when framed as the scene
/// frames it: scene/src/fit.js coverFit, a cover fit that crops a wide view mostly from the
/// bottom. The screen saver draws its still of the wall there while the scene loads, so the
/// scene fades in over the same picture. Keep in step with fit.js and scene/src/wall.js.
func wallPhotoFrame(in view: CGSize) -> CGRect {
  let wall = CGSize(width: 1600, height: 1067), anchorY: CGFloat = 0.1
  let scale = max(view.width / wall.width, view.height / wall.height)
  let size = CGSize(width: wall.width * scale, height: wall.height * scale)
  let top = (size.height - view.height) * anchorY   // cropped above the view
  return CGRect(x: (view.width - size.width) / 2, y: view.height + top - size.height, width: size.width, height: size.height)
}

/// The desktop still's names, used in turn. macOS caches a desktop picture by its path and the
/// moment it was chosen: set again under the same path, a changed still would never show (the
/// lock screen kept the bare photo, 2026-09-29). So a changed still goes under a name no screen
/// shows. Before these, the still was always "still.jpg".
let stillNames = ["still-a.jpg", "still-b.jpg"]

/// The name to show the still under: the one whose file already holds exactly this still, else
/// the first that no screen shows now (the first name if both are).
func stillName(holding: String?, shown: Set<String>) -> String {
  holding ?? stillNames.first { !shown.contains($0) } ?? stillNames[0]
}

/// System Settings' page for choosing the screen saver: macOS 26 moved it into Wallpaper; up to
/// macOS 15 it had a page of its own. A page System Settings does not know opens General instead.
func screenSaverSettingsPage(macOSMajor: Int) -> String {
  macOSMajor >= 26 ? "com.apple.Wallpaper-Settings.extension" : "com.apple.ScreenSaver-Settings.extension"
}

/// Whether the screen is locked, from the login session's info (CGSessionCopyCurrentDictionary):
/// macOS starts a fresh legacyScreenSaver just after locking, too late to hear "screen is locked".
func screenLocked(sessionInfo: [String: Any]?) -> Bool {
  switch sessionInfo?["CGSSessionScreenIsLocked"] {
  case let flag as Bool: return flag
  case let number as NSNumber: return number.boolValue
  case let number as Int: return number != 0
  default: return false
  }
}

/// The screen-saver session after a system notification. Only "did start" and "did stop"
/// count: macOS 26 also sends "will stop" as a saver starts.
func screenSaverSession(after notification: String, running: Bool) -> Bool {
  switch notification {
  case "com.apple.screensaver.didstart": return true
  case "com.apple.screensaver.didstop": return false
  default: return running
  }
}

/// Whether a screen-saver session is already on when a host process starts: macOS starts a
/// fresh legacyScreenSaver *for* a run after posting "did start", so the new process would
/// never hear it. ScreenSaverEngine runs exactly while a screen saver does.
func screenSaverSessionAtLaunch(runningApps: [String]) -> Bool {
  runningApps.contains("com.apple.ScreenSaver.Engine")
}

/// The weathers, in menu order, each with its modes, lightest first (mode 0 is Off), and the hint
/// under its pop-up in the screen saver's Options. One at a time: as in scene/src/main.js.
let weathers: [(name: String, modes: [String], hint: String)] = [
  ("Rain", ["Drizzle", "Steady", "Monsoon"], "Rain falling in front of the wall."),
  ("Snow", ["Flurries", "Steady", "Blizzard"], "Snow falling in front of the wall."),
]

/// Off, or the one weather that is on (a `weathers` index) and its mode (1…).
struct WeatherChoice: Equatable {
  var weather: Int?
  var mode: Int
  static let off = WeatherChoice(weather: nil, mode: 0)

  /// That weather's mode: 0 unless it is the one on.
  func mode(of weather: Int) -> Int { self.weather == weather ? mode : 0 }
  /// Every weather's mode, in `weathers` order: at most one is not 0.
  var modes: [Int] { weathers.indices.map(mode(of:)) }
  /// As stored: "off", or the weather's name in lower case and its mode, e.g. "snow:3".
  var stored: String { weather.map { "\(weathers[$0].name.lowercased()):\(mode)" } ?? "off" }
}

/// The weather after choosing `mode` in `weather`'s submenu or pop-up: a mode makes it the one
/// weather (every other goes off); its Off (0) turns only it off, so nothing changes while
/// another weather is on.
func choosing(weather: Int, mode: Int, from current: WeatherChoice) -> WeatherChoice {
  if mode > 0 { return WeatherChoice(weather: weather, mode: min(mode, weathers[weather].modes.count)) }
  return current.weather == weather ? .off : current
}

/// The weather to use: the stored choice (`weather`, e.g. "snow:3") with its mode clamped;
/// before there was one, the Rain mode earlier versions stored (`rain`, 0…3); anything
/// unreadable is Off.
func weatherChoice(stored: String?, legacyRain: Int?) -> WeatherChoice {
  guard let stored else { return choosing(weather: 0, mode: max(0, legacyRain ?? 0), from: .off) }
  let parts = stored.split(separator: ":", omittingEmptySubsequences: false)
  guard parts.count == 2, let weather = weathers.firstIndex(where: { $0.name.lowercased() == parts[0] }),
    let mode = Int(parts[1])
  else { return .off }
  return choosing(weather: weather, mode: max(0, mode), from: .off)
}

/// The scene's page asked for this weather: "rain=0&snow=2" (scene/src/main.js reads them).
func weatherQuery(_ choice: WeatherChoice) -> String {
  weathers.indices.map { "\(weathers[$0].name.lowercased())=\(choice.mode(of: $0))" }.joined(separator: "&")
}

/// The scene told this weather: "wallSetRain(0); wallSetSnow(2)" (Off first would do too: a
/// weather set to 0 turns only itself off).
func weatherScript(_ choice: WeatherChoice) -> String {
  weathers.indices.map { "wallSet\(weathers[$0].name)(\(choice.mode(of: $0)))" }.joined(separator: "; ")
}

/// What the screen saver's Options sheet broadcasts to every saver host, as the notification's
/// object (sandboxed senders cannot attach userInfo): "<motion>,<each weather's mode>", in
/// `weathers` order, e.g. "4,0,2".
func optionsBroadcast(motion: Int, weather: WeatherChoice) -> String {
  ([motion] + weather.modes).map(String.init).joined(separator: ",")
}

/// The Motion level (clamped) and the weather from that broadcast, or nil when it is malformed,
/// including two weathers on at once. The two-part "<motion>,<rain>" of earlier versions still reads.
func optionsFromBroadcast(_ object: String?) -> (motion: Int, weather: WeatherChoice)? {
  guard let parts = object?.split(separator: ",", omittingEmptySubsequences: false),
    parts.count == 2 || parts.count == weathers.count + 1, let level = Int(parts[0])
  else { return nil }
  var choice = WeatherChoice.off
  for (index, part) in parts.dropFirst().enumerated() {
    guard let mode = Int(part), (0...weathers[index].modes.count).contains(mode) else { return nil }
    if mode > 0 {
      guard choice == .off else { return nil }
      choice = WeatherChoice(weather: index, mode: mode)
    }
  }
  return (motionLevel(stored: level), choice)
}
