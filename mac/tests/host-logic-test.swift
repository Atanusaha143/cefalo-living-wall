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

    let still = URL(fileURLWithPath: "/Users/me/Library/Application Support/Cefalo Living Wall/still.jpg")
    let oldStill = URL(fileURLWithPath: "/Users/me/Library/Application Support/Green Wall/still.jpg")
    let mine = URL(fileURLWithPath: "/Users/me/Pictures/beach.jpg")
    let other = URL(fileURLWithPath: "/Users/me/Pictures/mountain.jpg")
    let saved = picturesToSave(
      current: ["1": mine, "2": still, "3": nil, "4": other, "5": oldStill], saved: ["4": mine.absoluteString], ours: [still, oldStill])
    check(saved["1"] == mine.absoluteString, "a screen's own picture is remembered")
    check(saved["2"] == nil, "our own still is never remembered as the user's picture")
    check(saved["5"] == nil, "nor is the old Green Wall still")
    check(saved["3"] == nil, "a screen with no readable picture is skipped")
    check(saved["4"] == mine.absoluteString, "a picture remembered earlier is never overwritten")

    let exists: (URL) -> Bool = { $0 != other }
    let restore = picturesToRestore(screens: ["1", "9"], saved: ["1": mine.absoluteString], exists: exists)
    check(restore["1"] == mine, "each screen gets its own picture back")
    check(restore["9"] == mine, "a screen whose ID changed falls back to a saved picture that still exists")
    check(picturesToRestore(screens: ["1"], saved: ["1": other.absoluteString], exists: exists).isEmpty,
      "a saved picture whose file is gone is not restored")
    // Migration from Green Wall: absent keys only, never overwriting, nothing unrelated.
    let imported = settingsToImport(
      old: ["paused": true, "motion": 2, "previousDesktopPictures": ["1": mine.absoluteString], "AppleLanguages": ["en"]],
      new: ["motion": 5])
    check(imported["paused"] as? Bool == true, "the pause choice carries over")
    check(imported["motion"] == nil, "a setting the new app already has is not overwritten")
    check((imported["previousDesktopPictures"] as? [String: String])?["1"] == mine.absoluteString, "the original wallpaper carries over")
    check(imported["AppleLanguages"] == nil, "unrelated preferences are ignored")

    check(shouldOfferScreenSaver(alreadyShown: false, saverInstalled: true), "the prompt is offered once the saver is installed")
    check(!shouldOfferScreenSaver(alreadyShown: true, saverInstalled: true), "never twice")
    check(!shouldOfferScreenSaver(alreadyShown: false, saverInstalled: false), "never without the saver")

    // macOS 26 pre-warms copies of the saver and gives no reliable "on screen" signal, so every
    // copy draws exactly while the system reports a screen-saver session.
    check(saverShouldRun(isPreview: false, sessionRunning: true, inHost: true), "during a screen-saver session every copy draws")
    check(!saverShouldRun(isPreview: false, sessionRunning: false, inHost: true), "between sessions the pre-warmed copies stay still")
    check(saverShouldRun(isPreview: true, sessionRunning: false, inHost: true), "the System Settings thumbnail always draws")
    check(saverShouldRun(isPreview: false, sessionRunning: false, inHost: false), "outside the screen-saver host (a check) it draws")
    check(screenSaverSession(after: "com.apple.screensaver.didstart", running: false), "did start begins a session")
    check(!screenSaverSession(after: "com.apple.screensaver.didstop", running: true), "did stop ends it")
    check(screenSaverSession(after: "com.apple.screensaver.willstop", running: true), "will stop changes nothing (macOS 26 also sends it at start)")
    // The Options sheet broadcasts the new level to every saver host as the notification's object.
    check(rainNames == ["Off", "Drizzle", "Steady", "Monsoon"], "Rain: Off and three modes, lightest first")
    check(rainMode(stored: nil) == 0 && rainMode(stored: 2) == 2, "no rain until a mode is chosen; a stored mode is used")
    check(rainMode(stored: 7) == 3 && rainMode(stored: -1) == 0, "a stored mode out of range is clamped")
    let read = { (object: String?) in optionsFromBroadcast(object).map { "\($0.motion) \($0.rain)" } }
    check(read("2,1") == "2 1" && read("4,0") == "4 0" && read("1,3") == "1 3", "Options' broadcast carries the Motion level and the Rain mode")
    check(read("9,0") == "5 0" && read("0,2") == "1 2", "a broadcast level is clamped")
    check([nil, "", "fast", "3", "3,4", "3,-1", "3,1,1", ",1", "3,"].allSatisfy { read($0) == nil }, "a malformed broadcast is ignored")
    check(read(optionsBroadcast(motion: 2, rain: 3)) == "2 3", "what Options sends is what every host reads")

    // A host macOS starts *for* a run appears after "did start": it must still know.
    check(screenSaverSessionAtLaunch(runningApps: ["com.apple.finder", "com.apple.ScreenSaver.Engine"]),
      "a host started during a screen-saver run knows the session is on")
    check(!screenSaverSessionAtLaunch(runningApps: ["com.apple.finder"]), "a pre-warmed host started between runs stays still")

    var covered = PowerState()
    covered.saverRunning = true
    check(covered.still, "the wallpaper rests while the screen saver plays over it")
    check(statusLine(failed: false, power: covered, paused: false, rate: 30) == "Stopped — screen saver", "and says so")
    exit(failures == 0 ? 0 : 1)
  }
}
