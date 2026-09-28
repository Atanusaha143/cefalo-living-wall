import Foundation

/// The live lock screen's hot corner: a corner of the screen set to Start Screen Saver. Starting
/// the screen saver locks the Mac behind the moving wall, which a lock with the power button
/// cannot do (it shows the still photo). macOS keeps hot corners in the Dock's settings:
/// com.apple.dock wvous-<corner>-corner is the action's code, wvous-<corner>-modifier its key.
/// The decisions are here; LivingWall.swift reads and writes the Dock's settings.
enum HotCorner: String, CaseIterable {
  case topLeft = "tl", topRight = "tr", bottomLeft = "bl", bottomRight = "br"

  var actionKey: String { "wvous-\(rawValue)-corner" }
  var modifierKey: String { "wvous-\(rawValue)-modifier" }
  /// For the menu.
  var title: String { "\(words.capitalized.replacingOccurrences(of: " ", with: "-")) Corner" }
  /// For sentences.
  var name: String { "\(words.replacingOccurrences(of: " ", with: "-")) corner" }
  private var words: String {
    switch self {
    case .topLeft: "top left"
    case .topRight: "top right"
    case .bottomLeft: "bottom left"
    case .bottomRight: "bottom right"
    }
  }
}

/// The hot-corner code for Start Screen Saver; 1 (or 0) is a corner that does nothing.
let startScreenSaver = 5
let noHotCornerAction = 1

/// What a hot-corner code does, as System Settings names it; nil for a corner that does nothing.
func hotCornerActionName(_ code: Int) -> String? {
  switch code {
  case 2: "Mission Control"
  case 3: "Application Windows"
  case 4: "Desktop"
  case 5: "Start Screen Saver"
  case 6: "Disable Screen Saver"
  case 7: "Dashboard"
  case 10: "Put Display to Sleep"
  case 11: "Launchpad"
  case 12: "Notification Center"
  case 13: "Lock Screen"
  case 14: "Quick Note"
  default: nil
  }
}

/// The corner that starts the screen saver now, whoever set it: the menu's tick.
func liveLockCorner(actions: [HotCorner: Int]) -> HotCorner? {
  HotCorner.allCases.first { actions[$0] == startScreenSaver }
}

/// What choosing a corner (nil for Off) changes: the codes to write, and the other action it
/// would replace, if any (then ask first).
struct HotCornerPlan: Equatable {
  var writes: [HotCorner: Int]
  var replaces: String?
}

/// Only one corner starts the screen saver: choosing one clears any other, Off clears them all.
func hotCornerPlan(actions: [HotCorner: Int], choose choice: HotCorner?) -> HotCornerPlan {
  var writes: [HotCorner: Int] = [:]
  for corner in HotCorner.allCases where corner != choice && actions[corner] == startScreenSaver {
    writes[corner] = noHotCornerAction
  }
  guard let choice, actions[choice] != startScreenSaver else { return HotCornerPlan(writes: writes, replaces: nil) }
  writes[choice] = startScreenSaver
  return HotCornerPlan(writes: writes, replaces: hotCornerActionName(actions[choice] ?? 0))
}

// The Settings window's Live Lock Screen pop-up: Off (item 0), then the corners in order.
let liveLockTitles = ["Off"] + HotCorner.allCases.map(\.title)

/// The corner a pop-up item stands for; nil for Off (or an item out of range).
func liveLockChoice(at index: Int) -> HotCorner? {
  (1...HotCorner.allCases.count).contains(index) ? HotCorner.allCases[index - 1] : nil
}

/// The pop-up item for a corner; 0 for Off.
func liveLockIndex(of corner: HotCorner?) -> Int {
  corner.flatMap { HotCorner.allCases.firstIndex(of: $0) }.map { $0 + 1 } ?? 0
}

/// The item the pop-up shows: the corner that starts the screen saver now, or Off.
func liveLockIndex(actions: [HotCorner: Int]) -> Int {
  liveLockIndex(of: liveLockCorner(actions: actions))
}
