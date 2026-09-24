import Foundation

/// Every reason the wall may not draw, kept apart: waking the display behind the lock
/// screen must not start the wall while the screen is still locked. Low Power Mode is
/// tracked for diagnostics but does not stop the wall (the user's choice).
struct PowerState: Equatable {
  var lowPower = false
  var locked = false
  var screensAsleep = false
  var sessionInactive = false
  var still: Bool { locked || screensAsleep || sessionInactive }
}

/// The menu's first line: why the wall is doing what it does.
func statusLine(failed: Bool, power: PowerState, paused: Bool, rate: Int) -> String {
  failed ? "Scene failed to load"
    : paused ? "Paused"
    : power.locked ? "Stopped — screen locked"
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

/// The Motion menu's levels, in the same order as scene/src/motion.js.
let motionNames = ["Calm", "Gentle", "Lively", "Energetic", "Wild"]

/// The Motion level to use: the stored choice clamped to 1…5, or Energetic (4) until the
/// user picks one.
func motionLevel(stored: Int?) -> Int {
  guard let stored else { return 4 }
  return min(motionNames.count, max(1, stored))
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

/// What happens to the screen saver's view, and why (see the spec's lifecycle table).
enum SaverEvent { case willStop, removedFromWindow, start, stop }
enum SaverAction: Equatable { case pause, resume, tearDown, exitProcess }

/// `inHost`: running inside macOS's legacyScreenSaver, the only process that may be exited.
/// It never tears finished savers down, so a real run ends by leaving the process; previews
/// live in System Settings' host and are only paused.
func saverActions(for event: SaverEvent, isPreview: Bool, inHost: Bool) -> [SaverAction] {
  switch event {
  case .willStop: return !isPreview && inHost ? [.pause, .exitProcess] : [.pause]
  case .removedFromWindow: return [.tearDown]
  case .start: return [.resume]
  case .stop: return [.pause]
  }
}
