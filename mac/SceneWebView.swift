// Shared by the wallpaper app and the screen saver: the bundled scene served over a
// private URL scheme (file:// allows neither ES module imports nor reading the photo's
// pixels), the page's messages, and a web view set up to show it.

import Cocoa
import WebKit

let sceneScheme = "living-wall"

/// The scene's page, with an optional query such as "t=10&smoke".
func sceneURL(_ query: String = "") -> URL {
  URL(string: "\(sceneScheme)://local/index.html" + (query.isEmpty ? "" : "?\(query)"))!
}

/// Serves the scene folder inside the bundle to the web views.
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
    // WebKit reports uncaught errors from this private-scheme page only as "Script error.",
    // so errors inside frame and timer callbacks are caught here with their details first.
    for (const name of ['requestAnimationFrame', 'setTimeout', 'setInterval']) {
      const original = window[name];
      window[name] = (fn, ...rest) => original((...args) => {
        try { return fn(...args); } catch (e) { post('error', [`${name}: ${e && e.name}: ${e && e.message}\n${e && e.stack}`]); throw e; }
      }, ...rest);
    }
    addEventListener('error', (e) => post('error', [`${e.message} at ${e.filename}:${e.lineno}`]));
    addEventListener('unhandledrejection', (e) => post('error', [e.reason]));
  })();
  """

func makeWebView(frame: NSRect, root: URL, messages: PageMessages) -> WKWebView {
  let settings = WKWebViewConfiguration()
  settings.setURLSchemeHandler(SceneHandler(root: root), forURLScheme: sceneScheme)
  settings.suppressesIncrementalRendering = true
  settings.websiteDataStore = .nonPersistent()
  settings.userContentController.addUserScript(
    WKUserScript(source: consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  settings.userContentController.add(messages, name: "wall")
  let view = WKWebView(frame: frame, configuration: settings)
  // WebKit stops drawing a page whose window it thinks is covered, and AppKit never
  // reports a desktop-level agent window (or a screen saver's) as visible, so the scene
  // would never start. The wallpaper works out what is covered itself (Coverage.swift).
  if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
    || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
  {
    view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
  }
  view.autoresizingMask = [.width, .height]
  return view
}
