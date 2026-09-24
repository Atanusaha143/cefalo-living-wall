// Cefalo Living Wall: the Cefalo green wall, alive, as the desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// desktop picture, below the icons, and it never takes a mouse event, so the desktop
// works as usual. Each window shows the bundled scene in a web view (SceneWebView.swift).
// The cursor position is read on a timer and handed to the scene; nothing else about the
// user's session is read except window positions.

import Cocoa
import ScreenSaver
import WebKit

func log(_ message: String) { NSLog("living-wall: \(message)") }

/// A window that keeps the exact frame it is given (AppKit insets ordinary windows).
final class DesktopWindow: NSWindow {
  override func constrainFrameRect(_ rect: NSRect, to screen: NSScreen?) -> NSRect { rect }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

let wallBackground = NSColor(calibratedRed: 0.027, green: 0.043, blue: 0.024, alpha: 1)

/// One screen's wall.
final class Wallpaper: NSObject, WKNavigationDelegate {
  let window: DesktopWindow
  let view: WKWebView
  private let messages = PageMessages()
  private(set) var failed = false
  /// The page said `ready`: its bridge functions exist.
  private(set) var ready = false
  private var loaded = false
  private var rate = -1
  private var paused = false
  private var motion = 4
  private var inside = false
  private var crashes = 0
  private var stableSince = Date()
  private var pointerSends = 0
  private var lastSent = NSPoint(x: -1, y: -1)

  /// `visible: false` keeps the window transparent (used by `--check`).
  init(screen: NSScreen, root: URL, visible: Bool = true) {
    view = makeWebView(frame: screen.frame, root: root, messages: messages)
    window = DesktopWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false, screen: screen)
    super.init()
    messages.handler = { [weak self] message in self?.received(message) }
    view.navigationDelegate = self
    view.underPageBackgroundColor = wallBackground
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.ignoresMouseEvents = true
    window.isOpaque = true
    window.hasShadow = false
    window.backgroundColor = wallBackground
    window.isReleasedWhenClosed = false
    window.canHide = false
    window.contentView = view
    window.setFrame(screen.frame, display: true)
    if !visible { window.alphaValue = 0 }
    window.orderFrontRegardless()
    view.load(URLRequest(url: sceneURL()))
  }

  func close() {
    view.navigationDelegate = nil
    view.configuration.userContentController.removeScriptMessageHandler(forName: "wall")
    view.removeFromSuperview()
    window.contentView = nil
    window.orderOut(nil)
    window.close()
  }

  private func received(_ message: [String: Any]) {
    switch message["type"] as? String {
    case "ready":
      // Only now do the page's wall* functions exist: WebKit reports the navigation
      // finished while the scene's module has not run yet, and calls made then are lost.
      failed = false
      ready = true
      loaded = true
      send()
    case "failed":
      failed = true
      log("the scene failed: \(message["reason"] ?? "unknown")")
      window.orderOut(nil)   // the still desktop picture shows instead
    default:
      log("page \(message["level"] ?? "log"): \(message["message"] ?? "")")
    }
  }

  /// Frame-rate cap for this screen; 0 halts it. Sent only on change.
  func setRate(_ wanted: Int) {
    guard wanted != rate else { return }
    rate = wanted
    if rate == 0 { setPointer(nil) }
    send()
  }

  func setPaused(_ wanted: Bool) {
    guard wanted != paused else { return }
    paused = wanted
    send()
  }

  /// The Motion level (1 Calm … 5 Wild).
  func setMotion(_ level: Int) {
    guard level != motion else { return }
    motion = level
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript("wallSetMaxFps(\(max(rate, 0))); wallSetPaused(\(paused)); wallSetMotion(\(motion))")
  }

  func water() {
    guard loaded, rate > 0, !paused else { return }
    view.evaluateJavaScript("wallWater()")
  }

  /// Cursor position in this window's top-left coordinates, or nil when it is not over
  /// this screen's visible desktop.
  func setPointer(_ point: NSPoint?) {
    guard loaded else { return }
    guard let point, rate > 0 else {
      if inside { view.evaluateJavaScript("wallPointerOut()") }
      inside = false
      return
    }
    inside = true
    pointerSends += 1
    lastSent = point
    view.evaluateJavaScript(String(format: "wallSetPointer(%.1f,%.1f)", point.x, point.y))
  }

  /// The page's wallState() as JSON, or nil before it can answer.
  func pageState(_ done: @escaping (String?) -> Void) {
    view.evaluateJavaScript("JSON.stringify(wallState())") { value, _ in done(value as? String) }
  }

  /// Log what this screen's host side and page are doing (see Controller's SIGUSR1 dump).
  func report(_ index: Int) {
    log("screen \(index): loaded \(loaded) rate \(rate) paused \(paused) failed \(failed) inside \(inside) pointerSends \(pointerSends) lastSent \(lastSent) window \(window.frame)")
    guard loaded else { return }
    view.evaluateJavaScript("JSON.stringify(wallState())") { value, error in
      log("screen \(index) page: \(value ?? error?.localizedDescription ?? "no answer")")
    }
  }


  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("the scene did not load: \(error.localizedDescription)")
  }

  /// WebKit's content process died: reload after 2 s, doubling up to 60 s; the backoff
  /// resets after five minutes of stable running.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = false
    ready = false
    inside = false
    if Date().timeIntervalSince(stableSince) > 300 { crashes = 0 }
    let wait = min(60, 2 * pow(2, Double(crashes)))
    crashes += 1
    log("the web content process ended; reloading in \(Int(wait)) s")
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
      guard let self else { return }
      self.stableSince = Date()
      self.view.load(URLRequest(url: sceneURL()))
    }
  }
}

/// Carrying the user's settings and files over from the app's old name, "Green Wall".
enum Migration {
  static let oldDomain = "local.green-wall"
  static let doneKey = "migratedFromGreenWall"
  static var oldFolder: URL { supportFolder("Green Wall") }
  static var oldStill: URL { oldFolder.appendingPathComponent("still.jpg") }

  /// Once: copy the pause choice, Motion level and remembered original wallpaper from the
  /// old preferences, never overwriting what the new app already has.
  static func importSettings() {
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: doneKey) else { return }
    let old = defaults.persistentDomain(forName: oldDomain) ?? [:]
    let new = defaults.persistentDomain(forName: Bundle.main.bundleIdentifier ?? "local.cefalo-living-wall") ?? [:]
    let imported = settingsToImport(old: old, new: new)
    for (key, value) in imported { defaults.set(value, forKey: key) }
    defaults.set(true, forKey: doneKey)
    if !imported.isEmpty { log("carried over from Green Wall: \(imported.keys.sorted())") }
  }

  /// The old support folder and log, once the new still is on the desktop.
  static func removeOldFiles() {
    let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs")
    for url in [oldFolder, logs.appendingPathComponent("Green Wall.log")] where FileManager.default.fileExists(atPath: url.path) {
      try? FileManager.default.removeItem(at: url)
    }
  }
}

func supportFolder(_ name: String) -> URL {
  FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
}

/// The still photo behind the live layer, and the user's own picture to restore later.
enum DesktopPicture {
  static let savedKey = "previousDesktopPictures"
  static var folder: URL { supportFolder("Cefalo Living Wall") }
  static var still: URL { folder.appendingPathComponent("still.jpg") }
  /// Every still this app has ever shown: never the user's own picture.
  static var ours: [URL] { [still, Migration.oldStill] }

  static func id(_ screen: NSScreen) -> String {
    "\((screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0)"
  }

  /// Copy the photo out of the bundle, remember each screen's current picture (once,
  /// and never our own), then show the photo as the desktop picture.
  static func install(photo: URL) {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: still)
    do { try FileManager.default.copyItem(at: photo, to: still) } catch {
      log("could not copy the still picture: \(error.localizedDescription)")
      return
    }
    // Remember the user's pictures, and persist that, before changing anything: if the
    // process died in between, the next launch would only see our own still.
    let previous = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    let current = Dictionary(NSScreen.screens.map { (id($0), NSWorkspace.shared.desktopImageURL(for: $0)) }) { a, _ in a }
    UserDefaults.standard.set(picturesToSave(current: current, saved: previous, ours: ours), forKey: savedKey)
    for screen in NSScreen.screens {
      do {
        try NSWorkspace.shared.setDesktopImageURL(
          still, for: screen,
          options: [.imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
      } catch {
        log("could not set the desktop picture: \(error.localizedDescription)")
      }
    }
    Migration.removeOldFiles()
  }

  /// Put back the pictures saved by install(). Returns false, keeping the record, if any
  /// screen still shows our still afterwards (uninstall then keeps the still's file).
  static func restore() -> Bool {
    let saved = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    let targets = picturesToRestore(
      screens: NSScreen.screens.map(id), saved: saved, exists: { FileManager.default.fileExists(atPath: $0.path) })
    for screen in NSScreen.screens {
      guard let url = targets[id(screen)] else { continue }
      try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
    }
    let ourPaths = Set(ours.map { $0.standardizedFileURL.path })
    let stuck = NSScreen.screens.filter {
      NSWorkspace.shared.desktopImageURL(for: $0).map { ourPaths.contains($0.standardizedFileURL.path) } ?? false
    }
    if !stuck.isEmpty {
      log("could not restore the desktop picture on \(stuck.count) screen(s)")
      return false
    }
    UserDefaults.standard.removeObject(forKey: savedKey)
    return true
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var screens: [Wallpaper] = []
  private var layout: [CGRect] = []
  private var power = PowerState()
  private var blockers: [CGRect] = []
  private var diagnostics: DispatchSourceSignal?
  private var applied = 0
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var coverageTimer: Timer?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let waterItem = NSMenuItem(title: "Water", action: #selector(water), keyEquivalent: "")
  private let pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "")
  private var motionItems: [NSMenuItem] = []
  private let screenSaverItem = NSMenuItem(
    title: "Screen Saver Settings…", action: #selector(openScreenSaverSettings), keyEquivalent: "")
  /// How fast and how far the leaves move; remembered across restarts.
  private var motion = motionLevel(stored: UserDefaults.standard.object(forKey: "motion") as? Int)
  /// Remembered across restarts. With no choice stored yet, Reduce Motion starts it paused.
  private var paused =
    UserDefaults.standard.object(forKey: "paused") as? Bool
    ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

  func applicationDidFinishLaunching(_ note: Notification) {
    DesktopPicture.install(photo: root.appendingPathComponent("assets/wall.jpg"))
    build()
    addMenu()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    // Each reason to stay still is tracked on its own (see PowerState).
    let workspace = NSWorkspace.shared.notificationCenter
    let events: [(NSNotification.Name, (inout PowerState) -> Void)] = [
      (NSWorkspace.screensDidSleepNotification, { $0.screensAsleep = true }),
      (NSWorkspace.screensDidWakeNotification, { $0.screensAsleep = false }),
      (NSWorkspace.sessionDidResignActiveNotification, { $0.sessionInactive = true }),
      (NSWorkspace.sessionDidBecomeActiveNotification, { $0.sessionInactive = false }),
    ]
    for (name, change) in events {
      _ = workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        change(&self.power)
        self.applyRate()
      }
    }
    for (name, locked) in [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)] {
      _ = DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.power.locked = locked
        self?.applyRate()
      }
    }
    // While the screen saver plays over the wall, the wall rests.
    for (name, running) in [("com.apple.screensaver.didstart", true), ("com.apple.screensaver.didstop", false)] {
      _ = DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        log("\(name)")
        self?.power.saverRunning = running
        self?.applyRate()
      }
    }
    // `kill -USR1 <pid>` logs what the host and each page are doing.
    signal(SIGUSR1, SIG_IGN)
    diagnostics = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    diagnostics?.setEventHandler { [weak self] in self?.report() }
    diagnostics?.resume()
    _ = NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) {
      [weak self] _ in self?.applyRate()
    }
    // Once the wall is up, offer (once) to use the screen saver too.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.offerScreenSaver() }
  }

  private func offerScreenSaver() {
    let key = "screenSaverPromptShown"
    let saver = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Screen Savers/Cefalo Living Wall.saver")
    guard shouldOfferScreenSaver(
      alreadyShown: UserDefaults.standard.bool(forKey: key), saverInstalled: FileManager.default.fileExists(atPath: saver.path))
    else { return }
    UserDefaults.standard.set(true, forKey: key)
    let alert = NSAlert()
    alert.messageText = "Use Cefalo Living Wall as your screen saver?"
    alert.informativeText = "It can play the living wall while your Mac is idle. Choose Cefalo Living Wall in Screen Saver settings."
    alert.addButton(withTitle: "Open Screen Saver Settings")
    alert.addButton(withTitle: "Not Now")
    NSApp.activate(ignoringOtherApps: true)
    if alert.runModal() == .alertFirstButtonReturn { openScreenSaverSettings() }
  }

  /// System Settings on the Screen Saver page (Apple's supported link), or System Settings itself.
  @objc private func openScreenSaverSettings() {
    if let page = URL(string: "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension"),
      NSWorkspace.shared.open(page)
    {
      return
    }
    NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
  }

  // Showing a full-screen window is itself a screen-parameter change, so compare first.
  @objc private func screensChanged() {
    guard NSScreen.screens.map(\.frame) != layout else { return }
    build()
  }

  private func build() {
    layout = NSScreen.screens.map(\.frame)
    for screen in screens { screen.close() }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root) }
    for screen in screens { screen.setMotion(motion) }
    applyRate()
  }

  /// Screen frames in CoreGraphics global coordinates (top-left origin), like window bounds.
  private func cgFrame(_ frame: CGRect) -> CGRect {
    let primary = NSScreen.screens.first?.frame.height ?? frame.maxY
    return CGRect(x: frame.minX, y: primary - frame.maxY, width: frame.width, height: frame.height)
  }

  /// Ordinary app windows on screen, excluding ours. Only bounds are read, never contents.
  private func windowBlockers() -> [CGRect] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
      return []
    }
    let me = ProcessInfo.processInfo.processIdentifier
    return list.compactMap { info -> CGRect? in
      guard info[kCGWindowLayer as String] as? Int == 0,
        info[kCGWindowOwnerPID as String] as? Int32 != me,
        info[kCGWindowAlpha as String] as? Double ?? 0 > 0.95,
        let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
      else { return nil }
      return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
  }

  private func report() {
    let point = NSEvent.mouseLocation
    let primary = NSScreen.screens.first?.frame.height ?? 0
    let visible = layout.map { visibleFraction(of: cgFrame($0), blockers: blockers) }
    log("host: power \(power) paused \(paused) applied \(applied) pointerRate \(pointerRate) blockers \(blockers.count) visible \(visible) cursor \(point) overWindow \(blockers.contains { $0.contains(CGPoint(x: point.x, y: primary - point.y)) })")
    for (index, screen) in screens.enumerated() { screen.report(index) }
  }

  func applyRate() {
    power.lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    let still = power.still
    blockers = still || paused ? [] : windowBlockers()
    applied = 0
    for (index, screen) in screens.enumerated() {
      let frame = index < layout.count ? cgFrame(layout[index]) : .zero
      let rate = still ? 0 : frameCap(visible: visibleFraction(of: frame, blockers: blockers))
      screen.setPaused(paused)
      screen.setRate(rate)
      applied = max(applied, paused ? 0 : rate)
    }
    updateTimers(pollCoverage: !still && !paused)
  }

  private func updateTimers(pollCoverage: Bool) {
    let wanted = min(30, applied)
    if wanted != pointerRate {
      pointerTimer?.invalidate()
      pointerTimer = nil
      pointerRate = wanted
      if wanted > 0 {
        pointerTimer = Timer.scheduledTimer(withTimeInterval: 1 / Double(wanted), repeats: true) { [weak self] _ in
          self?.trackPointer()
        }
      }
    }
    if !pollCoverage {
      coverageTimer?.invalidate()
      coverageTimer = nil
    } else if coverageTimer == nil {
      coverageTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.applyRate() }
    }
  }

  private func trackPointer() {
    let point = NSEvent.mouseLocation
    guard abs(point.x - lastPoint.x) > 0.2 || abs(point.y - lastPoint.y) > 0.2 else { return }
    lastPoint = point
    let primary = NSScreen.screens.first?.frame.height ?? 0
    let overWindow = blockers.contains { $0.contains(CGPoint(x: point.x, y: primary - point.y)) }
    for (index, screen) in NSScreen.screens.enumerated() where index < screens.count {
      let frame = screen.frame
      screens[index].setPointer(
        !overWindow && frame.contains(point) ? NSPoint(x: point.x - frame.minX, y: frame.maxY - point.y) : nil)
    }
  }

  // MARK: - Menu bar

  private func addMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let symbol = NSImage(systemSymbolName: "leaf.fill", accessibilityDescription: "Cefalo Living Wall")
    symbol?.isTemplate = true
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Cefalo Living Wall" }
    item.button?.toolTip = "Cefalo Living Wall"
    let menu = NSMenu()
    menu.delegate = self
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    for entry in [waterItem, pauseItem] {
      entry.target = self
      menu.addItem(entry)
    }
    let levels = NSMenu(title: "Motion")
    levels.autoenablesItems = false
    for (index, name) in motionNames.enumerated() {
      let item = NSMenuItem(title: name, action: #selector(chooseMotion), keyEquivalent: "")
      item.target = self
      item.tag = index + 1
      levels.addItem(item)
      motionItems.append(item)
    }
    let motionMenu = NSMenuItem(title: "Motion", action: nil, keyEquivalent: "")
    motionMenu.submenu = levels
    menu.addItem(motionMenu)
    screenSaverItem.target = self
    menu.addItem(screenSaverItem)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    item.menu = menu
    status = item
  }

  /// The status line says why the wall is still: unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    state.title = statusLine(failed: screens.contains(where: \.failed), power: power, paused: paused, rate: applied)
    for item in motionItems { item.state = item.tag == motion ? .on : .off }
    pauseItem.title = paused ? "Resume" : "Pause"
    pauseItem.isEnabled = true
    waterItem.isEnabled = !paused && applied > 0
  }

  @objc private func water() { for screen in screens { screen.water() } }

  @objc private func chooseMotion(_ sender: NSMenuItem) {
    motion = sender.tag
    UserDefaults.standard.set(motion, forKey: "motion")
    for screen in screens { screen.setMotion(motion) }
  }

  @objc private func togglePause() {
    paused.toggle()
    UserDefaults.standard.set(paused, forKey: "paused")
    applyRate()
  }

  @objc private func quit() { NSApp.terminate(nil) }
}

/// `Cefalo Living Wall --check`: load the scene in a hidden web view, frozen at 10 s, and exit 0
/// if it reports that it drew a real frame. Used by the installer and mac/tests/run.sh.
final class SceneCheck: NSObject, NSApplicationDelegate {
  private let messages = PageMessages()
  private var window: NSWindow?
  private var wall: Wallpaper?

  func applicationDidFinishLaunching(_ note: Notification) {
    let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
    let frame = NSRect(x: 0, y: 0, width: 800, height: 520)
    let view = makeWebView(frame: frame, root: root, messages: messages)
    let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.contentView = view
    window.orderFrontRegardless()
    self.window = window
    messages.handler = { message in
      let type = message["type"] as? String, level = message["level"] as? String
      if type == "failed" { Self.finish(false, "scene failed: \(message["reason"] ?? "")") }
      if type == "log", level == "error" { Self.finish(false, "page error: \(message["message"] ?? "")") }
      if type == "log", level == "smoke", let text = message["message"] as? String {
        guard text.contains("\"nonBlank\":true") && text.contains("\"webgl2\":true") else { Self.finish(false, text) }
        print("Frame check passed: \(text)")
        self.checkBridge(root: root)
      }
    }
    view.load(URLRequest(url: sceneURL("t=10&smoke")))
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { Self.finish(false, "timed out waiting for the scene") }
  }

  /// A hidden live wall driven exactly as the host drives one: the rate is set before the
  /// page has loaded, then the scene must really stop, restart and receive the cursor.
  private func checkBridge(root: URL) {
    let wall = Wallpaper(screen: NSScreen.main ?? NSScreen.screens[0], root: root, visible: false)
    self.wall = wall
    wall.setPaused(false)
    wall.setMotion(2)
    wall.setRate(0)
    func expect(_ what: String, after delay: Double, _ test: @escaping (String) -> Bool, then next: @escaping () -> Void) {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        wall.pageState { state in
          guard let state, test(state) else { Self.finish(false, "\(what): \(state ?? "no answer")") }
          next()
        }
      }
    }
    func whenReady(_ next: @escaping () -> Void) {
      if wall.ready { next() } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { whenReady(next) } }
    }
    whenReady {
      expect("the scene kept running after the host asked for 0 fps", after: 1,
        { $0.contains("\"running\":false") && $0.contains("\"motion\":2") }) {
        wall.setRate(30)
        expect("the scene did not restart at 30 fps", after: 1, { $0.contains("\"running\":true") }) {
          wall.setPointer(NSPoint(x: 300, y: 300))
          expect("the cursor did not reach the scene", after: 0.5, { !$0.contains("\"pointerCalls\":0") }) {
            Self.finish(true, "the host can stop, start and steer the scene")
          }
        }
      }
    }
  }

  static func finish(_ ok: Bool, _ detail: String) -> Never {
    print(ok ? "Scene check passed: \(detail)" : "Scene check FAILED: \(detail)")
    exit(ok ? 0 : 1)
  }
}

/// `Cefalo Living Wall --check-saver <path>`: load the built screen saver into this process,
/// show a full-screen view and a thumbnail preview in hidden windows, and exit 0 only if both
/// reach `ready` and run at 30 and 15 fps with the saver's Motion option. Used by the
/// installer and mac/tests/run.sh.
final class SaverCheck: NSObject, NSApplicationDelegate {
  private var windows: [NSWindow] = []
  private var views: [NSView] = []
  private var pending = 2

  func applicationDidFinishLaunching(_ note: Notification) {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--check-saver"), index + 1 < arguments.count,
      let bundle = Bundle(path: arguments[index + 1]), bundle.load(),
      let saverClass = bundle.principalClass as? ScreenSaverView.Type
    else { Self.finish(false, "could not load the screen saver bundle") }
    let motion = motionLevel(
      stored: ScreenSaverDefaults(forModuleWithName: "local.cefalo-living-wall.saver")?.object(forKey: "motion") as? Int)
    for isPreview in [false, true] {
      let frame = NSRect(x: 0, y: 0, width: isPreview ? 320 : 1200, height: isPreview ? 200 : 750)
      guard let view = saverClass.init(frame: frame, isPreview: isPreview) else { Self.finish(false, "the saver view did not initialise") }
      let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
      window.alphaValue = 0
      window.ignoresMouseEvents = true
      window.contentView = view
      window.orderFrontRegardless()
      view.startAnimation()
      windows.append(window)
      views.append(view)
      let fps = isPreview ? 15 : 30
      poll(view, name: isPreview ? "preview" : "full screen", tries: 60) {
        $0.contains("\"running\":true") && $0.contains("\"maxFps\":\(fps)") && $0.contains("\"motion\":\(motion)")
          && Self.drawn($0) > 10   // really animating, not just ready
      }
    }
  }

  private func poll(_ view: NSView, name: String, tries: Int, until test: @escaping (String) -> Bool) {
    guard tries > 0 else { Self.finish(false, "the \(name) saver never ran as expected") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      guard let web = view.subviews.compactMap({ $0 as? WKWebView }).first else {
        Self.finish(false, "the \(name) saver shows no scene")
      }
      web.evaluateJavaScript("typeof wallState === 'function' ? JSON.stringify(wallState()) : ''") { value, _ in
        guard let state = value as? String, test(state) else {
          return self.poll(view, name: name, tries: tries - 1, until: test)
        }
        print("Saver \(name) runs: \(state.prefix(90))…")
        self.pending -= 1
        if self.pending == 0 {
          if name.hasSuffix("(Options)") { Self.finish(true, "the screen saver runs full screen and as a preview, and Options reach it") }
          else { self.checkOptions() }
        }
      }
    }
  }

  /// Options' Done tells every view in the process the new level; both must switch to Calm.
  private func checkOptions() {
    pending = views.count
    NotificationCenter.default.post(name: .init("LivingWallSaverMotionChanged"), object: nil, userInfo: ["level": 1])
    for (index, view) in views.enumerated() {
      poll(view, name: index == 0 ? "full screen (Options)" : "preview (Options)", tries: 20) { $0.contains("\"motion\":1") }
    }
  }

  static func drawn(_ state: String) -> Int {
    guard let range = state.range(of: #""drawn":(\d+)"#, options: .regularExpression) else { return 0 }
    return Int(state[range].dropFirst(8)) ?? 0
  }

  static func finish(_ ok: Bool, _ detail: String) -> Never {
    print(ok ? "Saver check passed: \(detail)" : "Saver check FAILED: \(detail)")
    exit(ok ? 0 : 1)
  }
}

@main
enum LivingWall {
  static func main() {
    let app = NSApplication.shared
    let arguments = CommandLine.arguments
    // Before anything reads preferences: the Controller's paused/motion start from them.
    let checking = arguments.contains("--check") || arguments.contains("--check-saver")
    if !checking { Migration.importSettings() }
    if arguments.contains("--restore-desktop-picture") {
      exit(DesktopPicture.restore() ? 0 : 1)
    }
    let delegate: NSApplicationDelegate =
      arguments.contains("--check-saver") ? SaverCheck() : arguments.contains("--check") ? SceneCheck() : Controller()
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }
}
