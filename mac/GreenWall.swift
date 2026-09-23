// Green Wall: the Cefalo green wall, alive, as the desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// desktop picture, below the icons, and it never takes a mouse event, so the desktop
// works as usual. Each window shows the bundled scene in a web view. The scene is
// served over a private URL scheme because file:// allows neither ES module imports
// nor reading the photo's pixels. The cursor position is read on a timer and handed to
// the scene; nothing else about the user's session is read except window positions.

import Cocoa
import WebKit

let scheme = "green-wall"
let sceneURL = URL(string: "\(scheme)://local/index.html")!

func log(_ message: String) { NSLog("green-wall: \(message)") }

/// Serves the scene folder inside the app bundle to the web views.
final class SceneHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  private static let types = [
    "html": "text/html", "js": "text/javascript", "css": "text/css",
    "json": "application/json", "jpg": "image/jpeg", "png": "image/png",
  ]

  init(root: URL) { self.root = root.standardizedFileURL }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Relays the page's messages ({type: "ready" | "failed" | "log", ...}) to a closure.
final class PageMessages: NSObject, WKScriptMessageHandler {
  var handler: ([String: Any]) -> Void = { _ in }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    handler(message.body as? [String: Any] ?? ["type": "log", "message": "\(message.body)"])
  }
}

/// Forwards console errors and warnings (and the smoke report) to the host's log.
let consoleScript = """
  (() => {
    const post = (level, parts) => window.webkit?.messageHandlers?.wall?.postMessage({
      type: 'log', level, message: parts.map((p) => (p && p.stack) || String(p)).join(' ') });
    for (const level of ['error', 'warn']) {
      const original = console[level];
      console[level] = (...parts) => { post(level, parts); original.apply(console, parts); };
    }
    const log = console.log;
    console.log = (...parts) => { if (String(parts[0]).startsWith('SMOKE ')) post('smoke', parts); log.apply(console, parts); };
    addEventListener('error', (e) => post('error', [`${e.message} at ${e.filename}:${e.lineno}`]));
    addEventListener('unhandledrejection', (e) => post('error', [e.reason]));
  })();
  """

func makeWebView(frame: NSRect, root: URL, messages: PageMessages) -> WKWebView {
  let settings = WKWebViewConfiguration()
  settings.setURLSchemeHandler(SceneHandler(root: root), forURLScheme: scheme)
  settings.suppressesIncrementalRendering = true
  settings.websiteDataStore = .nonPersistent()
  settings.userContentController.addUserScript(
    WKUserScript(source: consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  settings.userContentController.add(messages, name: "wall")
  let view = WKWebView(frame: frame, configuration: settings)
  // WebKit stops drawing a page whose window it thinks is covered, and AppKit never
  // reports a desktop-level agent window as visible, so the scene would never start.
  // The host works out what is covered itself (Coverage.swift).
  if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
    || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
  {
    view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
  }
  view.autoresizingMask = [.width, .height]
  return view
}

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
  private var loaded = false
  private var rate = -1
  private var paused = false
  private var inside = false
  private var crashes = 0
  private var stableSince = Date()

  init(screen: NSScreen, root: URL) {
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
    window.orderFrontRegardless()
    view.load(URLRequest(url: sceneURL))
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
      failed = false
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

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript("wallSetMaxFps(\(max(rate, 0))); wallSetPaused(\(paused))")
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
    view.evaluateJavaScript(String(format: "wallSetPointer(%.1f,%.1f)", point.x, point.y))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    send()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("the scene did not load: \(error.localizedDescription)")
  }

  /// WebKit's content process died: reload after 2 s, doubling up to 60 s; the backoff
  /// resets after five minutes of stable running.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = false
    if Date().timeIntervalSince(stableSince) > 300 { crashes = 0 }
    let wait = min(60, 2 * pow(2, Double(crashes)))
    crashes += 1
    log("the web content process ended; reloading in \(Int(wait)) s")
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
      guard let self else { return }
      self.stableSince = Date()
      self.view.load(URLRequest(url: sceneURL))
    }
  }
}

/// The still photo behind the live layer, and the user's own picture to restore later.
enum DesktopPicture {
  static let savedKey = "previousDesktopPictures"
  static var folder: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Green Wall")
  }
  static var still: URL { folder.appendingPathComponent("still.jpg") }

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
    var saved = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    for screen in NSScreen.screens {
      let key = id(screen)
      if saved[key] == nil, let current = NSWorkspace.shared.desktopImageURL(for: screen),
        current.standardizedFileURL.path != still.standardizedFileURL.path
      {
        saved[key] = current.absoluteString
      }
      do {
        try NSWorkspace.shared.setDesktopImageURL(
          still, for: screen,
          options: [.imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
      } catch {
        log("could not set the desktop picture: \(error.localizedDescription)")
      }
    }
    UserDefaults.standard.set(saved, forKey: savedKey)
  }

  /// Put back the pictures saved by install(), where those files still exist.
  static func restore() {
    let saved = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    for screen in NSScreen.screens {
      guard let text = saved[id(screen)], let url = URL(string: text),
        FileManager.default.fileExists(atPath: url.path)
      else { continue }
      try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
    }
    UserDefaults.standard.removeObject(forKey: savedKey)
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var screens: [Wallpaper] = []
  private var layout: [CGRect] = []
  private var awake = true
  private var blockers: [CGRect] = []
  private var applied = 0
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var coverageTimer: Timer?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let waterItem = NSMenuItem(title: "Water", action: #selector(water), keyEquivalent: "")
  private let pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "")
  /// Remembered across restarts. With no choice stored yet, Reduce Motion starts it paused.
  private var paused =
    UserDefaults.standard.object(forKey: "paused") as? Bool
    ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  private var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }

  func applicationDidFinishLaunching(_ note: Notification) {
    DesktopPicture.install(photo: root.appendingPathComponent("assets/wall.jpg"))
    build()
    addMenu()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    let workspace = NSWorkspace.shared.notificationCenter
    for (name, value) in [
      (NSWorkspace.screensDidSleepNotification, false), (NSWorkspace.screensDidWakeNotification, true),
      (NSWorkspace.sessionDidResignActiveNotification, false), (NSWorkspace.sessionDidBecomeActiveNotification, true),
    ] {
      workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)] {
      DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) {
      [weak self] _ in self?.applyRate()
    }
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

  func applyRate() {
    let still = lowPower || !awake
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
    let symbol = NSImage(systemSymbolName: "leaf.fill", accessibilityDescription: "Green Wall")
    symbol?.isTemplate = true
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Green Wall" }
    item.button?.toolTip = "Green Wall"
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
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    item.menu = menu
    status = item
  }

  /// The status line says why the wall is still: unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    state.title =
      screens.contains(where: \.failed) ? "Scene failed to load"
      : lowPower ? "Stopped — Low Power Mode"
      : paused ? "Paused"
      : !awake ? "Stopped — screen asleep"
      : applied == 0 ? "Stopped — covered by windows"
      : "Running · \(applied) fps"
    pauseItem.title = paused ? "Resume" : "Pause"
    pauseItem.isEnabled = !lowPower
    waterItem.isEnabled = !paused && applied > 0
  }

  @objc private func water() { for screen in screens { screen.water() } }

  @objc private func togglePause() {
    paused.toggle()
    UserDefaults.standard.set(paused, forKey: "paused")
    applyRate()
  }

  @objc private func quit() { NSApp.terminate(nil) }
}

/// `Green Wall --check`: load the scene in a hidden web view, frozen at 10 s, and exit 0
/// if it reports that it drew a real frame. Used by the installer and mac/tests/run.sh.
final class SceneCheck: NSObject, NSApplicationDelegate {
  private let messages = PageMessages()
  private var window: NSWindow?

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
        Self.finish(text.contains("\"nonBlank\":true") && text.contains("\"webgl2\":true"), text)
      }
    }
    view.load(URLRequest(url: URL(string: "\(scheme)://local/index.html?t=10&smoke")!))
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { Self.finish(false, "timed out waiting for the scene") }
  }

  static func finish(_ ok: Bool, _ detail: String) {
    print(ok ? "Scene check passed: \(detail)" : "Scene check FAILED: \(detail)")
    exit(ok ? 0 : 1)
  }
}

@main
enum GreenWall {
  static func main() {
    let app = NSApplication.shared
    let arguments = CommandLine.arguments
    if arguments.contains("--restore-desktop-picture") {
      DesktopPicture.restore()
      return
    }
    let delegate: NSApplicationDelegate = arguments.contains("--check") ? SceneCheck() : Controller()
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }
}
