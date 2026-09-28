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
/// what was saved before stays, none of our own stills (current or from the Green Wall
/// days) is ever recorded, and a screen whose picture cannot be read is skipped.
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

/// The preferences carried over from the old "Green Wall" app: only these keys, and only
/// those the new app does not have yet.
let importedSettingKeys = ["paused", "motion", "previousDesktopPictures"]

func settingsToImport(old: [String: Any], new: [String: Any]) -> [String: Any] {
  var out: [String: Any] = [:]
  for key in importedSettingKeys where new[key] == nil {
    if let value = old[key] { out[key] = value }
  }
  return out
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

/// The Rain menu and the screen saver's Rain pop-up: Off, then the modes, lightest first.
let rainNames = ["Off", "Drizzle", "Steady", "Monsoon"]

/// The Rain mode to use: the stored choice clamped to 0 (Off)…3 (Monsoon), or Off.
func rainMode(stored: Int?) -> Int {
  guard let stored else { return 0 }
  return min(rainNames.count - 1, max(0, stored))
}

/// What the screen saver's Options sheet broadcasts to every saver host, as the notification's
/// object (sandboxed senders cannot attach userInfo): "<motion>,<rain mode>".
func optionsBroadcast(motion: Int, rain: Int) -> String { "\(motion),\(rain)" }

/// The Motion level (clamped) and Rain mode from that broadcast, or nil when it is malformed.
func optionsFromBroadcast(_ object: String?) -> (motion: Int, rain: Int)? {
  guard let parts = object?.split(separator: ",", omittingEmptySubsequences: false), parts.count == 2,
    let level = Int(parts[0]), let rain = Int(parts[1]), rainNames.indices.contains(rain)
  else { return nil }
  return (motionLevel(stored: level), rain)
}
