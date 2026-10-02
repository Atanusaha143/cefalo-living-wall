// HR Is Watching: the green wall, alive, as the desktop wallpaper, with HR peeking over the hedge.
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
  private var weather = WeatherChoice.off
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

  /// The Motion level (3 Gentle, 4 Lively, 5 Wild).
  func setMotion(_ level: Int) {
    guard level != motion else { return }
    motion = level
    send()
  }

  /// The one weather (Rain or Snow, and its mode), or none.
  func setWeather(_ choice: WeatherChoice) {
    guard choice != weather else { return }
    weather = choice
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript(
      "wallSetMaxFps(\(max(rate, 0))); wallSetPaused(\(paused)); wallSetMotion(\(motion)); \(weatherScript(weather))")
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

func supportFolder(_ name: String) -> URL {
  FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
}

/// The Dock's hot corners (HotCorner.swift decides what to write). The Dock only reads them
/// when it starts, so a change restarts it; macOS brings it straight back.
enum DockCorners {
  static let domain = "com.apple.dock" as CFString

  static func read() -> [HotCorner: Int] {
    CFPreferencesAppSynchronize(domain)
    var actions: [HotCorner: Int] = [:]
    for corner in HotCorner.allCases {
      actions[corner] = (CFPreferencesCopyAppValue(corner.actionKey as CFString, domain) as? NSNumber)?.intValue ?? 0
    }
    return actions
  }

  static func write(_ codes: [HotCorner: Int]) {
    for (corner, code) in codes {
      CFPreferencesSetAppValue(corner.actionKey as CFString, code as CFNumber, domain)
      if code == startScreenSaver { CFPreferencesSetAppValue(corner.modifierKey as CFString, 0 as CFNumber, domain) }
    }
    CFPreferencesAppSynchronize(domain)
    let restart = Process()
    restart.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
    restart.arguments = ["Dock"]
    try? restart.run()
  }
}

/// The still behind the live layer (the scene's first frame, SceneStill.swift), and the user's
/// own picture to restore later.
enum DesktopPicture {
  static let savedKey = "previousDesktopPictures"
  static var folder: URL { supportFolder("HR Is Watching") }
  /// The still under each of its names (stillNames, used in turn): never the user's own picture.
  static var stills: [URL] { stillNames.map { folder.appendingPathComponent($0) } }

  static func id(_ screen: NSScreen) -> String {
    "\((screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0)"
  }

  /// Copy the still out of the bundle, under a name macOS will show afresh if it has changed
  /// (stillName), remember each screen's current picture (once, and never our own), then show
  /// the still as the desktop picture.
  static func install(photo: URL) {
    let files = FileManager.default
    try? files.createDirectory(at: folder, withIntermediateDirectories: true)
    let onScreen = Set(NSScreen.screens.compactMap { NSWorkspace.shared.desktopImageURL(for: $0)?.standardizedFileURL.path })
    let holding = stills.first { files.contentsEqual(atPath: $0.path, andPath: photo.path) }
    let shown = stills.filter { onScreen.contains($0.standardizedFileURL.path) }.map(\.lastPathComponent)
    let still = folder.appendingPathComponent(stillName(holding: holding?.lastPathComponent, shown: Set(shown)))
    if still != holding {
      try? files.removeItem(at: still)
      do { try files.copyItem(at: photo, to: still) } catch {
        log("could not copy the still picture: \(error.localizedDescription)")
        return
      }
      log("desktop still: \(still.lastPathComponent)")
    }
    // Remember the user's pictures, and persist that, before changing anything: if the
    // process died in between, the next launch would only see our own still.
    let previous = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    let current = Dictionary(NSScreen.screens.map { (id($0), NSWorkspace.shared.desktopImageURL(for: $0)) }) { a, _ in a }
    UserDefaults.standard.set(picturesToSave(current: current, saved: previous, ours: stills), forKey: savedKey)
    for screen in NSScreen.screens {
      do {
        try NSWorkspace.shared.setDesktopImageURL(
          still, for: screen,
          options: [.imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
      } catch {
        log("could not set the desktop picture: \(error.localizedDescription)")
      }
    }
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
    let ourPaths = Set(stills.map { $0.standardizedFileURL.path })
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
  private let pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "")
  /// Each weather's submenu items (`weathers` order), Off then its modes; each item's tag is its mode.
  private var weatherItems: [[NSMenuItem]] = []
  private var motionItems: [NSMenuItem] = []
  private let settingsItem = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
  /// Menu ▸ Settings…: the settings set once (SettingsWindow.swift), made when first opened.
  private lazy var settings = SettingsWindow(openScreenSaverSettings: { [weak self] in self?.openScreenSaverSettings() })
  /// How fast and how far the leaves move; remembered across restarts.
  private var motion = motionLevel(stored: UserDefaults.standard.object(forKey: "motion") as? Int)
  /// The one weather on every screen, or none; remembered across restarts, Off until chosen
  /// (a Rain mode stored by an earlier version carries over).
  private var weather = weatherChoice(
    stored: UserDefaults.standard.string(forKey: "weather"), legacyRain: UserDefaults.standard.object(forKey: "rain") as? Int)
  /// Remembered across restarts. With no choice stored yet, Reduce Motion starts it paused.
  private var paused =
    UserDefaults.standard.object(forKey: "paused") as? Bool
    ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

  func applicationDidFinishLaunching(_ note: Notification) {
    DesktopPicture.install(photo: Bundle.main.resourceURL!.appendingPathComponent("still.jpg"))
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
      .appendingPathComponent("Screen Savers/HR Is Watching.saver")
    guard shouldOfferScreenSaver(
      alreadyShown: UserDefaults.standard.bool(forKey: key), saverInstalled: FileManager.default.fileExists(atPath: saver.path))
    else { return }
    UserDefaults.standard.set(true, forKey: key)
    let alert = NSAlert()
    alert.messageText = "Use HR Is Watching as your screen saver?"
    alert.informativeText = "It can play the living wall while your Mac is idle. Choose HR Is Watching in Screen Saver settings."
    alert.addButton(withTitle: "Open Screen Saver Settings")
    alert.addButton(withTitle: "Not Now")
    NSApp.activate(ignoringOtherApps: true)
    if alert.runModal() == .alertFirstButtonReturn { openScreenSaverSettings() }
  }

  /// System Settings on the page where the screen saver is chosen (Apple's supported link), or
  /// System Settings itself.
  @objc private func openScreenSaverSettings() {
    let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
    if let page = URL(string: "x-apple.systempreferences:\(screenSaverSettingsPage(macOSMajor: major))"),
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
    for screen in screens {
      screen.setMotion(motion)
      screen.setWeather(weather)
    }
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
    // Cefalo's three dots with two leaves opening from them (MenuIcon); the item fits its width.
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let icon = MenuIcon.image()
    item.button?.image = icon
    if icon == nil { item.button?.title = "HR Is Watching" }
    item.button?.toolTip = "HR Is Watching"
    let menu = NSMenu()
    menu.delegate = self
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    pauseItem.target = self
    menu.addItem(pauseItem)
    for (index, weather) in weathers.enumerated() {
      let modes = NSMenu(title: weather.name)
      modes.autoenablesItems = false
      var items: [NSMenuItem] = []
      for (mode, name) in (["Off"] + weather.modes).enumerated() {
        let item = NSMenuItem(title: name, action: #selector(chooseWeather), keyEquivalent: "")
        item.target = self
        item.tag = mode
        item.representedObject = index
        modes.addItem(item)
        items.append(item)
      }
      weatherItems.append(items)
      let submenu = NSMenuItem(title: weather.name, action: nil, keyEquivalent: "")
      submenu.submenu = modes
      menu.addItem(submenu)
    }
    let levels = NSMenu(title: "Motion")
    levels.autoenablesItems = false
    for (level, name) in motionLevels {
      let item = NSMenuItem(title: name, action: #selector(chooseMotion), keyEquivalent: "")
      item.target = self
      item.tag = level
      levels.addItem(item)
      motionItems.append(item)
    }
    let motionMenu = NSMenuItem(title: "Motion", action: nil, keyEquivalent: "")
    motionMenu.submenu = levels
    menu.addItem(motionMenu)
    settingsItem.target = self
    menu.addItem(settingsItem)
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
    for (index, items) in weatherItems.enumerated() {
      for item in items { item.state = item.tag == weather.mode(of: index) ? .on : .off }
    }
  }

  @objc private func openSettings() { settings.show() }

  @objc private func chooseMotion(_ sender: NSMenuItem) {
    motion = sender.tag
    UserDefaults.standard.set(motion, forKey: "motion")
    for screen in screens { screen.setMotion(motion) }
  }

  /// One weather at a time: a mode turns every other weather off; a weather's Off turns only it off.
  @objc private func chooseWeather(_ sender: NSMenuItem) {
    guard let index = sender.representedObject as? Int else { return }
    weather = choosing(weather: index, mode: sender.tag, from: weather)
    UserDefaults.standard.set(weather.stored, forKey: "weather")
    for screen in screens { screen.setWeather(weather) }
  }

  @objc private func togglePause() {
    paused.toggle()
    UserDefaults.standard.set(paused, forKey: "paused")
    applyRate()
  }

  @objc private func quit() { NSApp.terminate(nil) }
}

/// `HR Is Watching --check`: load the scene in a hidden web view, frozen, raining and then
/// snowing, and exit 0 if it reports that it drew a real frame each time (and the app has its
/// still for the desktop picture and its icon).
/// Used by the installer and mac/tests/run.sh.
final class SceneCheck: NSObject, NSApplicationDelegate {
  private let messages = PageMessages()
  private var window: NSWindow?
  private var wall: Wallpaper?

  func applicationDidFinishLaunching(_ note: Notification) {
    // The desktop picture: the still of the scene's first frame, rendered by build.sh.
    let still = NSImage(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("still.jpg"))?.representations.first
    guard let still, CGSize(width: still.pixelsWide, height: still.pixelsHigh) == SceneStill.wallPixels else {
      Self.finish(false, "the app has no still of the whole wall for the desktop picture")
    }
    // Its icon, also rendered by build.sh: every size macOS asks for, 16 to 1024 px.
    let icon = NSImage(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("AppIcon.icns"))
    let sizes = Set(icon?.representations.map(\.pixelsWide) ?? [])
    guard Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") as? String == "AppIcon",
      sizes.isSuperset(of: [16, 32, 64, 128, 256, 512, 1024])
    else { Self.finish(false, "the app has no icon of every size (it has \(sizes.sorted()))") }
    let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
    let frame = NSRect(x: 0, y: 0, width: 800, height: 520)
    let view = makeWebView(frame: frame, root: root, messages: messages)
    let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.contentView = view
    window.orderFrontRegardless()
    self.window = window
    // Raining, then snowing, so WebKit compiles the rain's and the snow's shaders too (it compiles
    // them only once they draw): a shader error fails the check.
    var frames = ["t=10&smoke&rain=2", "t=30&smoke&snow=3"]
    messages.handler = { message in
      let type = message["type"] as? String, level = message["level"] as? String
      if type == "failed" { Self.finish(false, "scene failed: \(message["reason"] ?? "")") }
      if type == "log", level == "error" { Self.finish(false, "page error: \(message["message"] ?? "")") }
      if type == "log", level == "smoke", let text = message["message"] as? String {
        guard text.contains("\"nonBlank\":true") && text.contains("\"webgl2\":true") else { Self.finish(false, text) }
        print("Frame check passed: \(text)")
        frames.removeFirst()
        if let next = frames.first { view.load(URLRequest(url: sceneURL(next))) } else { self.checkBridge(root: root) }
      }
    }
    view.load(URLRequest(url: sceneURL(frames[0])))
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { Self.finish(false, "timed out waiting for the scene") }
  }

  /// A hidden live wall driven exactly as the host drives one: the rate is set before the
  /// page has loaded, then the scene must really stop, restart and receive the cursor.
  private func checkBridge(root: URL) {
    let wall = Wallpaper(screen: NSScreen.main ?? NSScreen.screens[0], root: root, visible: false)
    self.wall = wall
    wall.setPaused(false)
    wall.setMotion(3)   // Gentle: not the default, so the page must have been told
    wall.setWeather(WeatherChoice(weather: 1, mode: 3))   // a Blizzard, as for a display connected while it snows
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
      expect("the scene kept running after the host asked for 0 fps, or missed Motion or Snow", after: 1,
        { $0.contains("\"running\":false") && $0.contains("\"motion\":3") && $0.contains("\"snow\":{\"mode\":3") }) {
        wall.setRate(30)
        expect("the scene did not restart at 30 fps", after: 1, { $0.contains("\"running\":true") }) {
          wall.setPointer(NSPoint(x: 300, y: 300))
          expect("the cursor did not reach the scene", after: 0.5, { !$0.contains("\"pointerCalls\":0") }) {
            wall.setWeather(WeatherChoice(weather: 0, mode: 2))
            expect("Steady rain did not replace the snow", after: 0.5,
              { $0.contains("\"rain\":{\"mode\":2") && $0.contains("\"snow\":{\"mode\":0") }) {
              wall.setWeather(WeatherChoice(weather: 1, mode: 1))
              expect("Flurries did not replace the rain", after: 0.5,
                { $0.contains("\"snow\":{\"mode\":1") && $0.contains("\"rain\":{\"mode\":0") }) {
                wall.setWeather(.off)
                expect("the weather did not stop", after: 0.5,
                  { $0.contains("\"rain\":{\"mode\":0") && $0.contains("\"snow\":{\"mode\":0") }) {
                  Self.finish(true, "the host can stop, start and steer the scene, and switch the weather, one at a time")
                }
              }
            }
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

/// `HR Is Watching --check-saver <path>`: load the built screen saver into this process,
/// show a full-screen view and a thumbnail preview in hidden windows, and exit 0 only if both
/// show the scene's first frame as a still while the scene loads, then reach `ready`, fade the
/// scene in and run at 30 and 15 fps with the saver's Motion option. Used by the installer and
/// mac/tests/run.sh.
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
      stored: ScreenSaverDefaults(forModuleWithName: "local.hr-is-watching.saver")?.object(forKey: "motion") as? Int)
    var polls: [() -> Void] = []
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
      let name = isPreview ? "preview" : "full screen", fps = isPreview ? 15 : 30
      checkLoading(view, name: name)
      watchFade(view, name: name)
      polls.append {
        self.poll(view, name: name, tries: 60) {
          $0.contains("\"running\":true") && $0.contains("\"maxFps\":\(fps)") && $0.contains("\"motion\":\(motion)")
            && Self.drawn($0) > 10   // really animating, not just ready
        }
      }
    }
    checkStill(views[0], scene: bundle.resourceURL!.appendingPathComponent("scene")) { polls.forEach { $0() } }
  }

  private func poll(_ view: NSView, name: String, tries: Int, until test: @escaping (String) -> Bool) {
    guard tries > 0 else { Self.finish(false, "the \(name) saver never ran as expected") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      guard let web = view.subviews.compactMap({ $0 as? WKWebView }).first else {
        Self.finish(false, "the \(name) saver shows no scene")
      }
      web.evaluateJavaScript("typeof wallState === 'function' ? JSON.stringify(wallState()) : ''") { value, _ in
        // Faded in all the way (on screen, not just the fade's target): the photo no longer shows.
        let shown = web.layer?.presentation()?.opacity ?? Float(web.alphaValue)
        guard let state = value as? String, test(state), shown > 0.999 else {
          return self.poll(view, name: name, tries: tries - 1, until: test)
        }
        print("Saver \(name) runs: \(state.prefix(90))…")
        self.pending -= 1
        if self.pending == 0 {
          if name.hasSuffix("(Options, snow)") {
            Self.finish(true, "the screen saver runs full screen and as a preview, and Options reach it, Rain and Snow too")
          } else if name.hasSuffix("(Options, rain)") {
            self.checkOptions(weather: WeatherChoice(weather: 1, mode: 2), "snow", expecting: ["\"snow\":{\"mode\":2", "\"rain\":{\"mode\":0"])
          } else {
            self.checkOptions(weather: WeatherChoice(weather: 0, mode: 2), "rain", expecting: ["\"rain\":{\"mode\":2"])
          }
        }
      }
    }
  }

  /// Options' Done tells every view in the process the new settings; both must switch to
  /// Gentle and the weather chosen (Steady rain, then Steady snow in its place).
  private func checkOptions(weather: WeatherChoice, _ label: String, expecting: [String]) {
    pending = views.count
    NotificationCenter.default.post(
      name: .init("LivingWallSaverOptionsChanged"), object: nil, userInfo: ["motion": 3, "weather": weather.stored])
    for (index, view) in views.enumerated() {
      poll(view, name: "\(index == 0 ? "full screen" : "preview") (Options, \(label))", tries: 20) { state in
        state.contains("\"motion\":3") && expecting.allSatisfy { state.contains($0) }
      }
    }
  }

  /// While the scene loads the saver keeps the page (white until it has painted) out of sight,
  /// so the still it draws underneath shows.
  private func checkLoading(_ view: NSView, name: String) {
    guard let web = view.subviews.compactMap({ $0 as? WKWebView }).first else { Self.finish(false, "the \(name) saver shows no scene") }
    if web.alphaValue != 0 { Self.finish(false, "the \(name) saver shows the page before it is ready: a white screen") }
  }

  /// The still under the loading scene is the scene's own first frame, framed as the scene frames
  /// it on this view, with the leaves the scene adds (the bare photo lacks them), so nothing
  /// changes but the motion when the scene fades in.
  private func checkStill(_ view: NSView, scene: URL, then next: @escaping () -> Void) {
    let pixels = view.convertToBacking(view.bounds).size, points = view.bounds.size
    SceneStill.render(root: scene, pixels: pixels) { first in
      guard let first else { Self.finish(false, "could not render the scene's first frame to compare the still with") }
      let still = Self.bitmap(pixels: pixels, points: points) { view.draw(view.bounds) }
      let frame = Self.bitmap(pixels: pixels, points: points) {
        NSImage(cgImage: first, size: points).draw(in: NSRect(origin: .zero, size: points))
      }
      let difference = Self.difference(still, frame)
      guard difference < 0.02 else {
        Self.finish(false, String(format: "the saver's still is not the scene's first frame (difference %.3f)", difference))
      }
      print(String(format: "Saver still matches the scene's first frame (difference %.3f)", difference))
      next()
    }
  }

  /// What `draw` paints into an RGBA bitmap `pixels` big, spanning `points`.
  static func bitmap(pixels: CGSize, points: CGSize, draw: () -> Void) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(pixels.width), pixelsHigh: Int(pixels.height), bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = points
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    return rep
  }

  /// The mean difference between two bitmaps of one size, in grey, 0 to 1 (every 4th pixel each way).
  static func difference(_ a: NSBitmapImageRep, _ b: NSBitmapImageRep) -> Double {
    guard let pa = a.bitmapData, let pb = b.bitmapData else { return 1 }
    var total = 0, count = 0
    for y in stride(from: 0, to: a.pixelsHigh, by: 4) {
      for x in stride(from: 0, to: a.pixelsWide, by: 4) {
        let i = y * a.bytesPerRow + x * 4, j = y * b.bytesPerRow + x * 4
        total += abs(Int(pa[i]) + Int(pa[i + 1]) + Int(pa[i + 2]) - Int(pb[j]) - Int(pb[j + 1]) - Int(pb[j + 2]))
        count += 1
      }
    }
    return Double(total) / Double(max(1, count) * 3 * 255)
  }

  /// Once ready, the scene fades in over the photo instead of cutting to it: AppKit sets the
  /// web view's alpha to 1 at once and animates its layer's opacity.
  private func watchFade(_ view: NSView, name: String, tries: Int = 600) {
    guard tries > 0 else { Self.finish(false, "the \(name) saver never showed the scene") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
      guard let web = view.subviews.compactMap({ $0 as? WKWebView }).first else { Self.finish(false, "the \(name) saver shows no scene") }
      guard web.alphaValue > 0 else { return self.watchFade(view, name: name, tries: tries - 1) }
      guard let fade = web.layer?.animation(forKey: "opacity"), fade.duration >= 1 else {
        Self.finish(false, "the \(name) saver cuts to the scene instead of fading it in")
      }
      print("Saver \(name) fades the scene in over \(fade.duration) s")
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
    // `--render-icon <folder.iconset>`: the app's icon at every size, for build.sh's iconutil.
    if let index = arguments.firstIndex(of: "--render-icon") {
      let ok = index + 1 < arguments.count && AppIcon.writeIconset(to: URL(fileURLWithPath: arguments[index + 1]))
      print(ok ? "Rendered the icon" : "Could not render the icon")
      exit(ok ? 0 : 1)
    }
    if arguments.contains("--restore-desktop-picture") {
      exit(DesktopPicture.restore() ? 0 : 1)
    }
    let delegate: NSApplicationDelegate =
      arguments.contains("--check-saver") ? SaverCheck()
      : arguments.contains("--check-settings") ? SettingsCheck()
      : arguments.contains("--render-still") ? StillRender()
      : arguments.contains("--check") ? SceneCheck() : Controller()
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }
}
