// Checks the live lock screen's hot corner decisions (the menu's Live Lock Screen submenu).
// A plain program: swiftc -parse-as-library mac/HotCorner.swift mac/tests/hot-corner-test.swift
import Foundation

@main
enum HotCornerTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static func main() {
    check(HotCorner.allCases.map(\.rawValue) == ["tl", "tr", "bl", "br"], "four corners, in the menu's order")
    check(HotCorner.topRight.actionKey == "wvous-tr-corner" && HotCorner.topRight.modifierKey == "wvous-tr-modifier",
      "stored where macOS keeps hot corners, in the Dock's settings")
    check(HotCorner.bottomLeft.title == "Bottom-Left Corner" && HotCorner.bottomLeft.name == "bottom-left corner",
      "a title for the menu, a name for sentences")

    check(hotCornerActionName(0) == nil && hotCornerActionName(1) == nil, "0 and 1 mean the corner does nothing")
    check(hotCornerActionName(14) == "Quick Note" && hotCornerActionName(2) == "Mission Control", "what a used corner does")

    check(liveLockCorner(actions: [:]) == nil, "no tick when no corner starts the screen saver")
    check(liveLockCorner(actions: [.topLeft: 2, .bottomRight: 5]) == .bottomRight,
      "the tick shows the corner that starts it, whoever set it")

    let free = hotCornerPlan(actions: [.topRight: 1], choose: .topRight)
    check(free == HotCornerPlan(writes: [.topRight: startScreenSaver], replaces: nil), "a free corner is set, no question")
    let used = hotCornerPlan(actions: [.bottomRight: 14], choose: .bottomRight)
    check(used == HotCornerPlan(writes: [.bottomRight: startScreenSaver], replaces: "Quick Note"),
      "a corner used for something else asks first, naming what it would replace")
    let moved = hotCornerPlan(actions: [.topRight: startScreenSaver, .bottomLeft: 1], choose: .bottomLeft)
    check(moved == HotCornerPlan(writes: [.topRight: 1, .bottomLeft: startScreenSaver], replaces: nil),
      "choosing another corner moves it: only one corner starts the screen saver")
    let again = hotCornerPlan(actions: [.topRight: startScreenSaver], choose: .topRight)
    check(again == HotCornerPlan(writes: [:], replaces: nil), "choosing the ticked corner changes nothing")
    let off = hotCornerPlan(actions: [.topRight: startScreenSaver, .bottomRight: 14], choose: nil)
    check(off == HotCornerPlan(writes: [.topRight: 1], replaces: nil), "Off clears the ticked corner and leaves the others")

    if failures > 0 {
      print("\(failures) failed")
      exit(1)
    }
  }
}
