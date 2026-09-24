// Cefalo Living Wall as a screen saver: the wallpaper's scene, one view per display and
// per System Settings thumbnail. macOS 26 hosts third-party savers in legacyScreenSaver,
// keeps pre-warmed copies of the selected one there, and gives no reliable signal for which
// copy is on screen; so every copy draws exactly while the system reports a screen-saver
// session (SaverSession, saverShouldRun in HostLogic.swift).

import ScreenSaver
import WebKit
import os

let saverLog = Logger(subsystem: "local.cefalo-living-wall.saver", category: "saver")
/// Public, or the unified log redacts it.
func slog(_ message: String) { saverLog.log("\(message, privacy: .public)") }

/// The saver's own settings, edited in its Options sheet.
enum SaverSettings {
  static let module = "local.cefalo-living-wall.saver"
  static var defaults: UserDefaults? { ScreenSaverDefaults(forModuleWithName: module) }
  static var motion: Int {
    get { motionLevel(stored: defaults?.object(forKey: "motion") as? Int) }
    set {
      defaults?.set(newValue, forKey: "motion")
      defaults?.synchronize()
    }
  }
}

/// The system's screen-saver session, shared by every view in this host process: a view
/// created just after "did start" (macOS 26 sometimes shows exactly that one) still knows.
enum SaverSession {
  private(set) static var running = false
  static let changed = Notification.Name("LivingWallSaverSessionChanged")
  /// A new Motion level from the Options sheet (in-process; userInfo["level"]).
  static let motionChanged = Notification.Name("LivingWallSaverMotionChanged")
  /// The Options sheet's broadcast to every saver host; the level is the object.
  static let motionBroadcast = "local.cefalo-living-wall.saver.motion"
  private static var observing = false

  static func observe() {
    guard !observing else { return }
    observing = true
    let apps = NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier)
    running = screenSaverSessionAtLaunch(runningApps: apps)
    slog("host started: session \(running ? "running" : "stopped") (\(apps.count) apps visible)")
    for name in ["com.apple.screensaver.didstart", "com.apple.screensaver.didstop", "com.apple.screensaver.willstop"] {
      _ = DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { _ in
        let next = screenSaverSession(after: name, running: running)
        slog("\(name): session \(next ? "running" : "stopped")")
        guard next != running else { return }
        running = next
        NotificationCenter.default.post(name: changed, object: nil)
      }
    }
    _ = DistributedNotificationCenter.default().addObserver(forName: .init(motionBroadcast), object: nil, queue: .main) { note in
      guard let level = motionFromBroadcast(note.object as? String) else { return }
      slog("motion changed to \(level) by Options")
      NotificationCenter.default.post(name: motionChanged, object: nil, userInfo: ["level": level])
    }
  }
}

/// The Options sheet. It keeps itself alive while shown: macOS may release the saver view
/// that built it, and a button's target is only held weakly, so Done would do nothing.
final class OptionsSheet: NSObject {
  private(set) static var current: OptionsSheet?
  let window: NSWindow
  private let popup: NSPopUpButton

  static func show() -> NSWindow {
    if let current { return current.window }   // the host may ask more than once
    let sheet = OptionsSheet()
    current = sheet
    slog("options sheet shown (motion \(SaverSettings.motion))")
    return sheet.window
  }

  private override init() {
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 150), styleMask: [.titled], backing: .buffered, defer: false)
    popup = NSPopUpButton(frame: NSRect(x: 90, y: 97, width: 190, height: 28), pullsDown: false)
    super.init()
    window.title = "Cefalo Living Wall"
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 150))
    let label = NSTextField(labelWithString: "Motion:")
    label.frame = NSRect(x: 20, y: 102, width: 70, height: 20)
    popup.addItems(withTitles: motionNames)
    popup.selectItem(at: SaverSettings.motion - 1)
    let hint = NSTextField(labelWithString: "How fast and how far the leaves move.")
    hint.frame = NSRect(x: 20, y: 66, width: 320, height: 20)
    hint.textColor = .secondaryLabelColor
    let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancel))
    cancel.frame = NSRect(x: 168, y: 16, width: 84, height: 30)
    cancel.keyEquivalent = "\u{1b}"
    let done = NSButton(title: "Done", target: self, action: #selector(save))
    done.frame = NSRect(x: 256, y: 16, width: 84, height: 30)
    done.keyEquivalent = "\r"
    for view in [label, popup, hint, cancel, done] { content.addSubview(view) }
    window.contentView = content
  }

  @objc private func save() {
    let level = motionLevel(stored: popup.indexOfSelectedItem + 1)
    SaverSettings.motion = level
    slog("options saved: motion \(level)")
    // This process's views, and every other saver host (the thumbnail may live elsewhere).
    NotificationCenter.default.post(name: SaverSession.motionChanged, object: nil, userInfo: ["level": level])
    DistributedNotificationCenter.default().postNotificationName(
      .init(SaverSession.motionBroadcast), object: "\(level)", userInfo: nil, deliverImmediately: true)
    close()
  }

  @objc private func cancel() {
    slog("options cancelled")
    close()
  }

  private func close() {
    if let parent = window.sheetParent { parent.endSheet(window) } else { window.close() }
    Self.current = nil
  }
}

@objc(LivingWallSaverView)
final class LivingWallSaverView: ScreenSaverView {
  private let messages = PageMessages()
  private var web: WKWebView?
  private var ready = false
  private var fallback = false
  private var readyTimer: Timer?
  private var lastRun: Bool?
  private var inHost: Bool { ProcessInfo.processInfo.processName == "legacyScreenSaver" }
  private var resources: URL { Bundle(for: LivingWallSaverView.self).resourceURL! }

  override init?(frame: NSRect, isPreview: Bool) {
    super.init(frame: frame, isPreview: isPreview)
    setUp()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setUp()
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  private func setUp() {
    animationTimeInterval = 1   // the page animates itself; animateOneFrame stays empty
    SaverSession.observe()
    NotificationCenter.default.addObserver(self, selector: #selector(sessionChanged), name: SaverSession.changed, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(motionChanged), name: SaverSession.motionChanged, object: nil)
    slog("started preview \(isPreview) frame \(frame) host \(ProcessInfo.processInfo.processName)")
    load()
  }

  private func load() {
    let view = makeWebView(frame: bounds, root: resources.appendingPathComponent("scene"), messages: messages)
    messages.handler = { [weak self] message in self?.received(message) }
    addSubview(view)
    web = view
    view.load(URLRequest(url: sceneURL("motion=\(SaverSettings.motion)")))
    readyTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
      guard let self, !self.ready else { return }
      slog("the scene was not ready within 15 s; showing the still photo")
      self.showStill()
    }
  }

  private func received(_ message: [String: Any]) {
    switch message["type"] as? String {
    case "ready":
      ready = true
      readyTimer?.invalidate()
      slog("ready preview \(isPreview) \(visibility)")
      send("wallSetMaxFps(\(isPreview ? 15 : 30)); wallSetMotion(\(SaverSettings.motion))")
      refresh()
    case "failed":
      slog("the scene failed: \(message["reason"] ?? "unknown")")
      showStill()
    default:
      slog("page \(message["level"] ?? "log"): \(message["message"] ?? "")")
    }
  }

  private func send(_ script: String) {
    guard ready else { return }
    web?.evaluateJavaScript(script)
  }

  /// Draw only while it is worth it (saverShouldRun); sent to the page on change.
  private func refresh() {
    guard ready else { return }
    let run = saverShouldRun(isPreview: isPreview, sessionRunning: SaverSession.running, inHost: inHost)
    guard run != lastRun else { return }
    lastRun = run
    send("wallSetPaused(\(!run))")
    slog("\(run ? "running" : "paused") preview \(isPreview) \(visibility)")
  }

  @objc private func sessionChanged() { refresh() }

  @objc private func motionChanged(_ note: Notification) {
    guard let level = note.userInfo?["level"] as? Int else { return }
    send("wallSetMotion(\(level))")
  }

  // macOS 26 calls these for pre-warmed copies too, so they only inform the log.
  override func startAnimation() {
    super.startAnimation()
    slog("startAnimation preview \(isPreview) \(visibility)")
    refresh()
  }

  override func stopAnimation() {
    super.stopAnimation()
    slog("stopAnimation preview \(isPreview) \(visibility)")
  }

  private var visibility: String {
    guard let window else { return "no window" }
    return "level \(window.level.rawValue) size \(bounds.size)"
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    slog("moved to window preview \(isPreview) \(visibility)")
    if window == nil {
      tearDown()   // e.g. System Settings replaced its thumbnail: don't let copies pile up
    } else if web == nil && !fallback {
      load()   // shown again after being removed
    }
  }

  private func tearDown() {
    readyTimer?.invalidate()
    lastRun = nil
    guard let view = web else { return }
    view.stopLoading()
    view.configuration.userContentController.removeScriptMessageHandler(forName: "wall")
    view.removeFromSuperview()
    web = nil
    ready = false
    slog("torn down (preview \(isPreview))")
  }

  // MARK: - Still photo when the scene cannot run

  private func showStill() {
    tearDown()
    fallback = true
    needsDisplay = true
  }

  override func draw(_ rect: NSRect) {
    NSColor(calibratedRed: 0.027, green: 0.043, blue: 0.024, alpha: 1).setFill()
    bounds.fill()
    guard fallback, let still = NSImage(contentsOf: resources.appendingPathComponent("scene/assets/wall.jpg")) else { return }
    let scale = max(bounds.width / still.size.width, bounds.height / still.size.height)
    let size = NSSize(width: still.size.width * scale, height: still.size.height * scale)
    still.draw(in: NSRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height))
  }

  override func animateOneFrame() {}

  // MARK: - Options sheet

  override var hasConfigureSheet: Bool { true }
  override var configureSheet: NSWindow? { OptionsSheet.show() }
}
