// Checks that a Motion level saved in the screen saver's Options sheet is really stored:
// another process must read it back, as a newly started screen-saver host does. A plain
// program: swiftc -parse-as-library mac/HostLogic.swift mac/SaverSettings.swift
// mac/tests/saver-settings-test.swift -framework ScreenSaver
// It stores under its own module name and removes what it stored.
import ScreenSaver

@main
enum SaverSettingsTest {
  static let module = "local.cefalo-living-wall.saver-test"
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  /// The Motion level a separate process reads (this program, run with --read).
  static func readInAnotherProcess() -> String {
    let child = Process()
    child.executableURL = Bundle.main.executableURL
    child.arguments = ["--read"]
    let output = Pipe()
    child.standardOutput = output
    do { try child.run() } catch { return "could not start: \(error)" }
    child.waitUntilExit()
    let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// First through cfprefsd (`defaults delete`, which waits for it), then the empty file it
  /// leaves: deleting the file alone races with cfprefsd writing it back.
  static func removeStored() {
    let defaults = Process()
    defaults.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
    defaults.arguments = ["-currentHost", "delete", module]
    defaults.standardError = FileHandle.nullDevice
    try? defaults.run()
    defaults.waitUntilExit()
    let byHost = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Preferences/ByHost")
    for name in (try? FileManager.default.contentsOfDirectory(atPath: byHost.path)) ?? [] where name.hasPrefix(module + ".") {
      try? FileManager.default.removeItem(at: byHost.appendingPathComponent(name))
    }
  }

  static func main() {
    let settings = SaverSettings(module: module)
    if CommandLine.arguments.dropFirst().first == "--read" {
      print(settings.motion)
      return
    }
    removeStored()
    check(readInAnotherProcess() == "4", "Energetic until Options saves a level")
    settings.motion = 1
    check(readInAnotherProcess() == "1", "Calm saved in Options is what a newly started screen-saver host reads")
    settings.motion = 5
    check(readInAnotherProcess() == "5", "and a later choice replaces it")
    removeStored()
    exit(failures == 0 ? 0 : 1)
  }
}
