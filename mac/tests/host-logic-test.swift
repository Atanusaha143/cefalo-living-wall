// Checks the host's pure decisions: power state, status line, and which desktop
// pictures to save and restore. A plain program (XCTest needs full Xcode):
// swiftc -parse-as-library mac/HostLogic.swift mac/tests/host-logic-test.swift
import Foundation

@main
enum HostLogicTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static func main() {
    // Lock, then the display sleeps, then the user wakes the display: still locked.
    var power = PowerState()
    power.locked = true
    power.screensAsleep = true
    power.screensAsleep = false
    check(power.still, "waking the display behind the lock screen keeps the wall still")
    check(statusLine(failed: false, power: power, paused: false, rate: 30) == "Stopped — screen locked",
      "the status line says the screen is locked")
    power.locked = false
    check(!power.still, "unlocking lets it run again")
    check(statusLine(failed: false, power: power, paused: false, rate: 30) == "Running · 30 fps", "running status")
    power.lowPower = true
    check(!power.still, "Low Power Mode does not stop the wall (user choice)")
    check(statusLine(failed: false, power: power, paused: false, rate: 30) == "Running · 30 fps", "and it says it is running")
    check(statusLine(failed: false, power: power, paused: true, rate: 0) == "Paused", "pausing still works in Low Power Mode")

    check(motionNames == ["Calm", "Gentle", "Lively", "Energetic", "Wild"], "five motion levels, Calm to Wild")
    check(motionLevel(stored: nil) == 4, "Energetic until the user picks another level")
    check(motionLevel(stored: 2) == 2, "a stored level is used")
    check(motionLevel(stored: 0) == 1 && motionLevel(stored: 9) == 5, "a stored level out of range is clamped")

    let still = URL(fileURLWithPath: "/Users/me/Library/Application Support/Green Wall/still.jpg")
    let mine = URL(fileURLWithPath: "/Users/me/Pictures/beach.jpg")
    let other = URL(fileURLWithPath: "/Users/me/Pictures/mountain.jpg")
    let saved = picturesToSave(current: ["1": mine, "2": still, "3": nil, "4": other], saved: ["4": mine.absoluteString], still: still)
    check(saved["1"] == mine.absoluteString, "a screen's own picture is remembered")
    check(saved["2"] == nil, "our own still is never remembered as the user's picture")
    check(saved["3"] == nil, "a screen with no readable picture is skipped")
    check(saved["4"] == mine.absoluteString, "a picture remembered earlier is never overwritten")

    let exists: (URL) -> Bool = { $0 != other }
    let restore = picturesToRestore(screens: ["1", "9"], saved: ["1": mine.absoluteString], exists: exists)
    check(restore["1"] == mine, "each screen gets its own picture back")
    check(restore["9"] == mine, "a screen whose ID changed falls back to a saved picture that still exists")
    check(picturesToRestore(screens: ["1"], saved: ["1": other.absoluteString], exists: exists).isEmpty,
      "a saved picture whose file is gone is not restored")
    exit(failures == 0 ? 0 : 1)
  }
}
