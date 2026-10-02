// HR Is Watching as a screen saver: the wallpaper's scene, one view per display and
// per System Settings thumbnail. macOS 26 hosts third-party savers in legacyScreenSaver,
// keeps pre-warmed copies of the selected one there, and gives no reliable signal for which
// copy is on screen; so every copy draws exactly while the system reports a screen-saver
// session or the screen is locked, displays awake (SaverSession, saverShouldRun in HostLogic.swift).

import ScreenSaver
import WebKit
import os

let saverLog = Logger(subsystem: "local.hr-is-watching.saver", category: "saver")
/// Public, or the unified log redacts it.
func slog(_ message: String) { saverLog.log("\(message, privacy: .public)") }

/// The system's screen-saver session, the screen lock and the displays' sleep, shared by every
/// view in this host process: a view created just after "did start" (macOS 26 sometimes shows
/// exactly that one) still knows.
enum SaverSession {
  private(set) static var running = false
  private(set) static var locked = false
  private(set) static var screensAsleep = false
  static let changed = Notification.Name("LivingWallSaverSessionChanged")
  /// New settings from the Options sheet (in-process; userInfo["motion"] Int, ["weather"] its stored String).
  static let optionsChanged = Notification.Name("LivingWallSaverOptionsChanged")
  /// The Options sheet's broadcast to every saver host; its object is optionsBroadcast(motion:weather:).
  static let broadcastName = "local.hr-is-watching.saver.options"
  private static var observing = false

  static func observe() {
    guard !observing else { return }
    observing = true
    let apps = NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier)
    running = screenSaverSessionAtLaunch(runningApps: apps)
    locked = screenLocked(sessionInfo: CGSessionCopyCurrentDictionary() as? [String: Any])
    slog("host started: session \(running ? "running" : "stopped"), screen \(locked ? "locked" : "unlocked") (\(apps.count) apps visible)")
    for name in ["com.apple.screensaver.didstart", "com.apple.screensaver.didstop", "com.apple.screensaver.willstop"] {
      _ = DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { _ in
        let next = screenSaverSession(after: name, running: running)
        slog("\(name): session \(next ? "running" : "stopped")")
        guard next != running else { return }
        running = next
        NotificationCenter.default.post(name: changed, object: nil)
      }
    }
    // A lock is no screen-saver session, yet the lock screen shows the saver.
    for (name, value) in [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)] {
      _ = DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { _ in
        slog(name)
        guard value != locked else { return }
        locked = value
        NotificationCenter.default.post(name: changed, object: nil)
      }
    }
    for (name, value) in [(NSWorkspace.screensDidSleepNotification, true), (NSWorkspace.screensDidWakeNotification, false)] {
      _ = NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { _ in
        slog("displays \(value ? "asleep" : "awake")")
        guard value != screensAsleep else { return }
        screensAsleep = value
        NotificationCenter.default.post(name: changed, object: nil)
      }
    }
    _ = DistributedNotificationCenter.default().addObserver(forName: .init(broadcastName), object: nil, queue: .main) { note in
      guard let options = optionsFromBroadcast(note.object as? String) else { return }
      slog("options changed to motion \(options.motion), weather \(options.weather.stored) by Options")
      NotificationCenter.default.post(
        name: optionsChanged, object: nil, userInfo: ["motion": options.motion, "weather": options.weather.stored])
    }
  }
}

/// The Options sheet. It keeps itself alive while shown: macOS may release the saver view
/// that built it, and a button's target is only held weakly, so Done would do nothing.
final class OptionsSheet: NSObject {
  private(set) static var current: OptionsSheet?
  let window: NSWindow
  private let popup: NSPopUpButton
  /// One per weather (`weathers`), Off then its modes: choosing a mode in one turns the others off.
  private var weatherPopups: [NSPopUpButton] = []

  static func show() -> NSWindow {
    if let current { return current.window }   // the host may ask more than once
    let sheet = OptionsSheet()
    current = sheet
    slog("options sheet shown (motion \(SaverSettings.shared.motion), weather \(SaverSettings.shared.weather.stored))")
    return sheet.window
  }

  private override init() {
    // Motion, then a pop-up for each weather, then the buttons: 64 points a row.
    let height = CGFloat(132 + 64 * weathers.count)
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: height), styleMask: [.titled], backing: .buffered, defer: false)
    popup = NSPopUpButton(frame: NSRect(x: 90, y: height - 53, width: 190, height: 28), pullsDown: false)
    super.init()
    window.title = "HR Is Watching"
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: height))
    func row(_ title: String, _ control: NSView, hint: String, top: CGFloat) {
      let label = NSTextField(labelWithString: title)
      label.frame = NSRect(x: 20, y: top + 5, width: 70, height: 20)
      let note = NSTextField(labelWithString: hint)
      note.frame = NSRect(x: 20, y: top - 25, width: 320, height: 20)
      note.textColor = .secondaryLabelColor
      for view in [label, control, note] { content.addSubview(view) }
    }
    for (level, name) in motionLevels {
      popup.addItem(withTitle: name)
      popup.lastItem?.tag = level
    }
    popup.selectItem(withTag: SaverSettings.shared.motion)
    row("Motion:", popup, hint: "How fast and how far the leaves move.", top: height - 53)
    let chosen = SaverSettings.shared.weather
    for (index, weather) in weathers.enumerated() {
      let top = height - 117 - 64 * CGFloat(index)
      let choice = NSPopUpButton(frame: NSRect(x: 90, y: top, width: 190, height: 28), pullsDown: false)
      choice.addItems(withTitles: ["Off"] + weather.modes)
      choice.selectItem(at: chosen.mode(of: index))
      choice.tag = index
      choice.target = self
      choice.action = #selector(chooseWeather)
      weatherPopups.append(choice)
      row("\(weather.name):", choice, hint: weather.hint, top: top)
    }
    let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancel))
    cancel.frame = NSRect(x: 168, y: 16, width: 84, height: 30)
    cancel.keyEquivalent = "\u{1b}"
    let done = NSButton(title: "Done", target: self, action: #selector(save))
    done.frame = NSRect(x: 256, y: 16, width: 84, height: 30)
    done.keyEquivalent = "\r"
    for view in [cancel, done] { content.addSubview(view) }
    window.contentView = content
  }

  /// One weather at a time: a mode chosen in one pop-up turns every other to Off at once.
  @objc private func chooseWeather(_ sender: NSPopUpButton) {
    guard sender.indexOfSelectedItem > 0 else { return }
    for other in weatherPopups where other !== sender { other.selectItem(at: 0) }
  }

  /// The weather the pop-ups show (at most one is not Off).
  private var chosenWeather: WeatherChoice {
    weatherPopups.reduce(WeatherChoice.off) { choosing(weather: $1.tag, mode: $1.indexOfSelectedItem, from: $0) }
  }

  @objc private func save() {
    let level = motionLevel(stored: popup.selectedTag()), weather = chosenWeather
    SaverSettings.shared.motion = level
    SaverSettings.shared.weather = weather
    slog("options saved: motion \(level), weather \(weather.stored)")
    // This process's views, and every other saver host (the thumbnail may live elsewhere).
    NotificationCenter.default.post(
      name: SaverSession.optionsChanged, object: nil, userInfo: ["motion": level, "weather": weather.stored])
    DistributedNotificationCenter.default().postNotificationName(
      .init(SaverSession.broadcastName), object: optionsBroadcast(motion: level, weather: weather), userInfo: nil,
      deliverImmediately: true)
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
  /// The scene's first frame as a still (SceneStill.swift, rendered by build.sh), decoded once
  /// for every view in the host.
  private static let still = NSImage(
    contentsOf: Bundle(for: LivingWallSaverView.self).resourceURL!.appendingPathComponent("still.jpg"))
  /// How long the moving wall takes to fade in over the still photo.
  private static let fadeIn: TimeInterval = 1.5

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
    NotificationCenter.default.addObserver(self, selector: #selector(optionsChanged), name: SaverSession.optionsChanged, object: nil)
    slog("started preview \(isPreview) frame \(frame) host \(ProcessInfo.processInfo.processName)")
    load()
  }

  private func load() {
    let view = makeWebView(frame: bounds, root: resources.appendingPathComponent("scene"), messages: messages)
    // macOS shows a fresh copy the moment the screen saver starts, and the scene takes about
    // 2 s to load; a web view is white until its page paints, so the still drawn underneath
    // shows until the scene is ready and fades in.
    view.alphaValue = 0
    messages.handler = { [weak self] message in self?.received(message) }
    addSubview(view)
    web = view
    let settings = SaverSettings.shared
    view.load(URLRequest(url: sceneURL("motion=\(settings.motion)&\(weatherQuery(settings.weather))")))
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
      let settings = SaverSettings.shared
      send("wallSetMaxFps(\(isPreview ? 15 : 30)); wallSetMotion(\(settings.motion)); \(weatherScript(settings.weather))")
      refresh()
      reveal()
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
    let run = saverShouldRun(
      isPreview: isPreview, sessionRunning: SaverSession.running, locked: SaverSession.locked,
      screensAsleep: SaverSession.screensAsleep, inHost: inHost)
    guard run != lastRun else { return }
    lastRun = run
    send("wallSetPaused(\(!run))")
    slog("\(run ? "running" : "paused") preview \(isPreview) \(visibility)")
  }

  /// The moving wall takes over from the still of its own first frame: only the motion changes.
  private func reveal() {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = Self.fadeIn
      context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      web?.animator().alphaValue = 1
    }
  }

  @objc private func sessionChanged() { refresh() }

  @objc private func optionsChanged(_ note: Notification) {
    guard let level = note.userInfo?["motion"] as? Int, let weather = note.userInfo?["weather"] as? String else { return }
    send("wallSetMotion(\(level)); \(weatherScript(weatherChoice(stored: weather, legacyRain: nil)))")
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

  // MARK: - The still: under the scene while it loads, and instead of it when it cannot run

  private func showStill() {
    tearDown()
    fallback = true
    needsDisplay = true
  }

  /// The whole wall, framed as the scene frames it (wallPhotoFrame), so the fade does not shift it.
  override func draw(_ rect: NSRect) {
    NSColor(calibratedRed: 0.027, green: 0.043, blue: 0.024, alpha: 1).setFill()
    bounds.fill()
    Self.still?.draw(in: wallPhotoFrame(in: bounds.size).offsetBy(dx: bounds.minX, dy: bounds.minY))
  }

  override func animateOneFrame() {}

  // MARK: - Options sheet

  override var hasConfigureSheet: Bool { true }
  override var configureSheet: NSWindow? { OptionsSheet.show() }
}
