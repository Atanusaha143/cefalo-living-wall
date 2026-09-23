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
/// what was saved before stays, the still itself is never recorded, and a screen whose
/// picture cannot be read is skipped.
func picturesToSave(current: [String: URL?], saved: [String: String], still: URL) -> [String: String] {
  var out = saved
  for (id, url) in current {
    guard out[id] == nil, let url, url.standardizedFileURL.path != still.standardizedFileURL.path else { continue }
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
