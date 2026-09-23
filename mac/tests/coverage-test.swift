// Checks the coverage maths. XCTest needs full Xcode, so this is a plain program:
// swiftc -parse-as-library mac/Coverage.swift mac/tests/coverage-test.swift
import CoreGraphics
import Foundation

@main
enum CoverageTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static func main() {
    let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
    let left = CGRect(x: 0, y: 0, width: 756, height: 982)
    let middle = CGRect(x: 378, y: 0, width: 756, height: 982)

    check(visibleFraction(of: screen, blockers: []) == 1, "no windows: all visible")
    check(visibleFraction(of: screen, blockers: [screen]) == 0, "one full-screen window: none visible")
    check(abs(visibleFraction(of: screen, blockers: [left]) - 0.5) < 0.01, "half covered: half visible")
    check(
      abs(visibleFraction(of: screen, blockers: [left, middle]) - 0.25) < 0.01,
      "two overlapping half windows: overlap counted once")
    let other = CGRect(x: 1512, y: 0, width: 1920, height: 1080)
    check(visibleFraction(of: screen, blockers: [other]) == 1, "a window on another screen does not count")
    check(frameCap(visible: 1) == 30 && frameCap(visible: 0.40) == 30, "mostly visible: 30 fps")
    check(frameCap(visible: 0.39) == 15 && frameCap(visible: 0.05) == 15, "mostly covered: 15 fps")
    check(frameCap(visible: 0.049) == 0 && frameCap(visible: 0) == 0, "almost fully covered: stopped")
    exit(failures == 0 ? 0 : 1)
  }
}
