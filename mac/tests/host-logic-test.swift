// Checks the host's pure decisions: power state, status line, and which desktop
// pictures to save and restore. A plain program (XCTest needs full Xcode):
// swiftc -parse-as-library mac/HostLogic.swift mac/tests/host-logic-test.swift
import CoreGraphics
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

    check(motionLevels.map { $0.name } == ["Gentle", "Lively", "Wild"], "three motion levels, Gentle to Wild")
    check(motionLevel(stored: nil) == 4, "Lively until the user picks another level")
    check(motionLevel(stored: 3) == 3 && motionLevel(stored: 5) == 5, "a stored level is used")
    check(motionLevel(stored: 1) == 3 && motionLevel(stored: 2) == 3, "a Calm or Gentle saved by a five-level version reads as Gentle")
    check(motionLevel(stored: 0) == 3 && motionLevel(stored: 9) == 5, "a stored level out of range is clamped")

    let still = URL(fileURLWithPath: "/Users/me/Library/Application Support/HR Is Watching/still-a.jpg")
    let mine = URL(fileURLWithPath: "/Users/me/Pictures/beach.jpg")
    let other = URL(fileURLWithPath: "/Users/me/Pictures/mountain.jpg")
    let saved = picturesToSave(
      current: ["1": mine, "2": still, "3": nil, "4": other], saved: ["4": mine.absoluteString], ours: [still])
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

    check(shouldOfferScreenSaver(alreadyShown: false, saverInstalled: true), "the prompt is offered once the saver is installed")
    check(!shouldOfferScreenSaver(alreadyShown: true, saverInstalled: true), "never twice")
    check(!shouldOfferScreenSaver(alreadyShown: false, saverInstalled: false), "never without the saver")

    // macOS 26 pre-warms copies of the saver and gives no reliable "on screen" signal, so every
    // copy draws exactly while the system reports a screen-saver session, or while the screen
    // is locked (a lock is no session, yet the lock screen shows the saver), displays awake.
    let run = { (preview: Bool, session: Bool, locked: Bool, asleep: Bool, host: Bool) in
      saverShouldRun(isPreview: preview, sessionRunning: session, locked: locked, screensAsleep: asleep, inHost: host)
    }
    check(run(false, true, false, false, true), "during a screen-saver session every copy draws")
    check(!run(false, false, false, false, true), "unlocked between sessions the pre-warmed copies stay still")
    check(run(false, false, true, false, true), "while the screen is locked the lock screen's copy draws")
    check(!run(false, false, true, true, true), "but not once the displays sleep (a night locked costs nothing)")
    check(!run(false, true, false, true, true), "nor a session whose displays have gone to sleep")
    check(run(true, false, false, false, true), "the System Settings thumbnail always draws")
    check(run(false, false, false, false, false), "outside the screen-saver host (a check) it draws")
    // System Settings' page for the screen saver: its own page up to macOS 15, inside Wallpaper from macOS 26.
    check(screenSaverSettingsPage(macOSMajor: 26) == "com.apple.Wallpaper-Settings.extension",
      "on macOS 26 the screen saver is chosen on the Wallpaper page")
    check(screenSaverSettingsPage(macOSMajor: 27) == "com.apple.Wallpaper-Settings.extension", "and after")
    check([13, 14, 15].allSatisfy { screenSaverSettingsPage(macOSMajor: $0) == "com.apple.ScreenSaver-Settings.extension" },
      "up to macOS 15 it has a page of its own")
    // A host macOS starts just after the lock never hears "screen is locked": it asks the session.
    check(screenLocked(sessionInfo: ["CGSSessionScreenIsLocked": 1]), "a session reporting the screen locked is locked")
    check(screenLocked(sessionInfo: ["CGSSessionScreenIsLocked": true]), "as a Bool too")
    check(!screenLocked(sessionInfo: ["CGSSessionScreenIsLocked": 0]) && !screenLocked(sessionInfo: [:]), "otherwise it is not")
    check(!screenLocked(sessionInfo: nil), "nor when there is no session to ask")
    check(screenSaverSession(after: "com.apple.screensaver.didstart", running: false), "did start begins a session")
    check(!screenSaverSession(after: "com.apple.screensaver.didstop", running: true), "did stop ends it")
    check(screenSaverSession(after: "com.apple.screensaver.willstop", running: true), "will stop changes nothing (macOS 26 also sends it at start)")
    // One weather at a time: Rain or Snow, each with three modes, lightest first.
    check(weathers.map(\.name) == ["Rain", "Snow"], "two weathers, Rain then Snow")
    check(weathers[0].modes == ["Drizzle", "Steady", "Monsoon"] && weathers[1].modes == ["Flurries", "Steady", "Blizzard"],
      "each with three modes, lightest first")
    let rain = { (mode: Int) in WeatherChoice(weather: 0, mode: mode) }, snow = { (mode: Int) in WeatherChoice(weather: 1, mode: mode) }
    check(choosing(weather: 1, mode: 2, from: rain(3)) == snow(2), "choosing a snow mode while it rains stops the rain")
    check(choosing(weather: 0, mode: 1, from: snow(3)) == rain(1), "and a rain mode stops the snow")
    check(choosing(weather: 0, mode: 0, from: rain(2)) == .off, "a weather's Off turns it off")
    check(choosing(weather: 0, mode: 0, from: snow(2)) == snow(2), "and changes nothing while the other weather is on")
    check(choosing(weather: 1, mode: 9, from: .off) == snow(3), "a mode out of range is clamped")
    check(snow(2).modes == [0, 2] && WeatherChoice.off.modes == [0, 0], "the scene gets every weather's mode, at most one on")
    check(weatherQuery(snow(2)) == "rain=0&snow=2" && weatherScript(rain(3)) == "wallSetRain(3); wallSetSnow(0)",
      "as the page's query and as calls to it")
    // Stored as one value, so two weathers can never both be stored as on.
    check(rain(3).stored == "rain:3" && snow(1).stored == "snow:1" && WeatherChoice.off.stored == "off", "stored as one value")
    check(weatherChoice(stored: "snow:2", legacyRain: 3) == snow(2), "the stored weather is used")
    check(weatherChoice(stored: "rain:7", legacyRain: nil) == rain(3) && weatherChoice(stored: "snow:-1", legacyRain: nil) == .off,
      "its mode clamped")
    check([nil, "off", "", "fog:1", "snow", "snow:two", "rain:1:1"].allSatisfy { weatherChoice(stored: $0, legacyRain: nil) == .off },
      "anything unreadable, or nothing yet, is Off")
    check(weatherChoice(stored: nil, legacyRain: 2) == rain(2) && weatherChoice(stored: nil, legacyRain: 0) == .off,
      "before there was one, the Rain mode earlier versions stored carries over")
    check(weatherChoice(stored: "off", legacyRain: 3) == .off, "but once a weather is stored, the old Rain mode is ignored")
    // The Options sheet broadcasts Motion and the weather to every saver host as the notification's object.
    let read = { (object: String?) in optionsFromBroadcast(object).map { "\($0.motion) \($0.weather.stored)" } }
    check(read("3,1,0") == "3 rain:1" && read("4,0,0") == "4 off" && read("5,0,3") == "5 snow:3",
      "Options' broadcast carries the Motion level and the weather")
    check(read("3,2") == "3 rain:2", "an earlier version's two-part broadcast (Motion, Rain) still reads")
    check(read("9,0,0") == "5 off" && read("1,0,2") == "3 snow:2", "a broadcast level is clamped")
    check([nil, "", "fast", "3", "3,4", "3,-1", "3,1,1", "3,0,4", "3,0,0,1", ",1", "3,"].allSatisfy { read($0) == nil },
      "a malformed broadcast, or one with both weathers on, is ignored")
    check(read(optionsBroadcast(motion: 5, weather: snow(3))) == "5 snow:3", "what Options sends is what every host reads")

    // A host macOS starts *for* a run appears after "did start": it must still know.
    check(screenSaverSessionAtLaunch(runningApps: ["com.apple.finder", "com.apple.ScreenSaver.Engine"]),
      "a host started during a screen-saver run knows the session is on")
    check(!screenSaverSessionAtLaunch(runningApps: ["com.apple.finder"]), "a pre-warmed host started between runs stays still")

    var covered = PowerState()
    covered.saverRunning = true
    check(covered.still, "the wallpaper rests while the screen saver plays over it")
    check(statusLine(failed: false, power: covered, paused: false, rate: 30) == "Stopped — screen saver", "and says so")

    // The still under the loading scene sits exactly where the scene draws the wall
    // (scene/src/fit.js coverFit), so the fade between them does not shift the picture.
    let near = { (a: CGRect, b: CGRect) in
      abs(a.minX - b.minX) < 0.01 && abs(a.minY - b.minY) < 0.01 && abs(a.width - b.width) < 0.01 && abs(a.height - b.height) < 0.01
    }
    check(near(wallPhotoFrame(in: CGSize(width: 1920, height: 1080)), CGRect(x: 0, y: -180.36, width: 1920, height: 1280.4)),
      "a wide display shows the wall's full width, cropped mostly from the bottom, like the scene")
    check(near(wallPhotoFrame(in: CGSize(width: 1512, height: 982)), CGRect(x: 0, y: -23.6835, width: 1512, height: 1008.315)),
      "the built-in display too")
    check(near(wallPhotoFrame(in: CGSize(width: 1000, height: 1000)), CGRect(x: -249.7657, y: 0, width: 1499.5314, height: 1000)),
      "a narrow view shows the wall's full height, cropped evenly left and right")
    check([CGSize(width: 1920, height: 1080), CGSize(width: 320, height: 200), CGSize(width: 800, height: 1200)].allSatisfy {
      wallPhotoFrame(in: $0).insetBy(dx: -0.001, dy: -0.001).contains(CGRect(origin: .zero, size: $0))
    }, "the still always covers the whole view")

    // The desktop still's name. macOS keeps showing its copy of a picture set again under the
    // same name, so a changed still must go under a name no screen shows.
    check(stillName(holding: nil, shown: []) == "still-a.jpg", "the first still, over the user's own picture")
    check(stillName(holding: "still-a.jpg", shown: ["still-a.jpg"]) == "still-a.jpg",
      "the same still again keeps its name: nothing new for macOS")
    check(stillName(holding: nil, shown: ["still-a.jpg"]) == "still-b.jpg", "a changed still goes under the other name")
    check(stillName(holding: nil, shown: ["still-b.jpg"]) == "still-a.jpg", "and back, the next time it changes")
    check(stillName(holding: "still-b.jpg", shown: ["still-a.jpg"]) == "still-b.jpg",
      "a file already holding this still is used, not written again")
    check(stillName(holding: nil, shown: ["still-a.jpg", "still-b.jpg"]) == "still-a.jpg",
      "both shown (an interrupted switch) and neither holds it: the first name")
    exit(failures == 0 ? 0 : 1)
  }
}
