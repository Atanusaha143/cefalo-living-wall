// Cefalo Living Wall as a screen saver: the wallpaper's scene, one view per display and
// per System Settings thumbnail. macOS 26 hosts third-party savers in legacyScreenSaver,
// which never calls stopAnimation and never tears finished savers down; what to do about
// that is decided by saverActions (HostLogic.swift).

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

@objc(LivingWallSaverView)
final class LivingWallSaverView: ScreenSaverView {
  /// Every live view in this process, so Options can update the running preview.
  private static let live = NSHashTable<LivingWallSaverView>.weakObjects()
  private let messages = PageMessages()
  private var web: WKWebView?
  private var ready = false
  private var fallback = false
  private var readyTimer: Timer?
  private var sheet: NSWindow?
  private var motionPopup: NSPopUpButton?
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

  deinit { DistributedNotificationCenter.default().removeObserver(self) }

  private func setUp() {
    animationTimeInterval = 1   // the page animates itself; animateOneFrame stays empty
    Self.live.add(self)
    DistributedNotificationCenter.default().addObserver(
      self, selector: #selector(willStop), name: .init("com.apple.screensaver.willstop"), object: nil)
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
      send("wallSetMaxFps(\(isPreview ? 15 : 30)); wallSetPaused(false); wallSetMotion(\(SaverSettings.motion))")
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

  private func perform(_ actions: [SaverAction]) {
    for action in actions {
      switch action {
      case .pause: send("wallSetPaused(true)")
      case .resume: send("wallSetPaused(false)")
      case .tearDown: tearDown()
      case .exitProcess:
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          slog("leaving the screen-saver host so nothing keeps running")
          exit(0)
        }
      }
    }
  }

  @objc private func willStop() { perform(saverActions(for: .willStop, isPreview: isPreview, inHost: inHost)) }

  override func startAnimation() {
    super.startAnimation()
    perform(saverActions(for: .start, isPreview: isPreview, inHost: inHost))
  }

  override func stopAnimation() {
    super.stopAnimation()
    perform(saverActions(for: .stop, isPreview: isPreview, inHost: inHost))
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      perform(saverActions(for: .removedFromWindow, isPreview: isPreview, inHost: inHost))
    } else if web == nil && !fallback {
      load()   // shown again after being removed
    }
  }

  private func tearDown() {
    readyTimer?.invalidate()
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

  override var configureSheet: NSWindow? {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 360, height: 150), styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Cefalo Living Wall"
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 150))
    let label = NSTextField(labelWithString: "Motion:")
    label.frame = NSRect(x: 20, y: 102, width: 70, height: 20)
    let popup = NSPopUpButton(frame: NSRect(x: 90, y: 97, width: 190, height: 28), pullsDown: false)
    popup.addItems(withTitles: motionNames)
    popup.selectItem(at: SaverSettings.motion - 1)
    let hint = NSTextField(labelWithString: "How fast and how far the leaves move.")
    hint.frame = NSRect(x: 20, y: 66, width: 320, height: 20)
    hint.textColor = .secondaryLabelColor
    let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelOptions))
    cancel.frame = NSRect(x: 168, y: 16, width: 84, height: 30)
    cancel.keyEquivalent = "\u{1b}"
    let done = NSButton(title: "Done", target: self, action: #selector(saveOptions))
    done.frame = NSRect(x: 256, y: 16, width: 84, height: 30)
    done.keyEquivalent = "\r"
    for view in [label, popup, hint, cancel, done] { content.addSubview(view) }
    window.contentView = content
    motionPopup = popup
    sheet = window
    return window
  }

  @objc private func saveOptions() {
    let level = (motionPopup?.indexOfSelectedItem ?? 3) + 1
    SaverSettings.motion = level
    for view in Self.live.allObjects { view.send("wallSetMotion(\(level))") }
    closeSheet()
  }

  @objc private func cancelOptions() { closeSheet() }

  private func closeSheet() {
    guard let sheet else { return }
    if let parent = sheet.sheetParent { parent.endSheet(sheet) } else { sheet.close() }
    self.sheet = nil
  }
}
