// The scene's first frame as a picture: what the live wall shows the moment it starts (the
// page's ?t=0 freezes it there), with the leaves the scene adds to the photo. The screen saver
// shows it while the scene loads and the app makes it the desktop picture, so a still never
// differs from the moving wall but for the motion. Rendered through WebKit in a hidden window.

import Cocoa
import WebKit

final class SceneStill: NSObject {
  /// The whole wall at the photo's own size (scene/assets/wall.jpg), for build.sh.
  static let wallPixels = CGSize(width: 3840, height: 2560)
  /// Each render keeps itself alive until it is done.
  private static var rendering: Set<SceneStill> = []

  private let window: NSWindow
  private let web: WKWebView
  private let messages = PageMessages()
  private let pixels: CGSize
  private let done: (CGImage?) -> Void

  /// The first frame, `pixels` big; nil if the scene fails or takes over 30 s. A view of the
  /// wall's own proportions shows the whole wall (scene/src/fit.js).
  static func render(root: URL, pixels: CGSize, done: @escaping (CGImage?) -> Void) {
    rendering.insert(SceneStill(root: root, pixels: pixels, done: done))
  }

  private init(root: URL, pixels: CGSize, done: @escaping (CGImage?) -> Void) {
    self.pixels = pixels
    self.done = done
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: .borderless, backing: .buffered, defer: false)
    // Sized in points so that it is exactly `pixels` on this Mac's backing scale.
    let scale = window.backingScaleFactor
    let frame = NSRect(x: 0, y: 0, width: pixels.width / scale, height: pixels.height / scale)
    window.setFrame(frame, display: false)
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    web = makeWebView(frame: frame, root: root, messages: messages)
    super.init()
    window.contentView = web
    window.orderFrontRegardless()
    messages.handler = { [weak self] message in
      switch message["type"] as? String {
      case "ready": self?.snapshotOnceDrawn()
      case "failed": self?.finish(nil)
      default: break
      }
    }
    web.load(URLRequest(url: sceneURL("t=0")))
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.finish(nil) }
  }

  /// A frozen page redraws its frame on every refresh; a few in, the frame is on screen.
  private func snapshotOnceDrawn(tries: Int = 100) {
    web.evaluateJavaScript("wallState().drawn") { [weak self] value, _ in
      guard let self else { return }
      guard (value as? Int ?? 0) >= 3 || tries == 0 else {
        return DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.snapshotOnceDrawn(tries: tries - 1) }
      }
      let config = WKSnapshotConfiguration()
      config.snapshotWidth = NSNumber(value: Double(self.web.bounds.width))
      self.web.takeSnapshot(with: config) { image, _ in
        let frame = image?.cgImage(forProposedRect: nil, context: nil, hints: nil)
        self.finish(frame.flatMap { $0.width == Int(self.pixels.width) && $0.height == Int(self.pixels.height) ? $0 : nil })
      }
    }
  }

  private func finish(_ frame: CGImage?) {
    guard Self.rendering.remove(self) != nil else { return }   // once
    web.configuration.userContentController.removeScriptMessageHandler(forName: "wall")
    window.orderOut(nil)
    done(frame)
  }
}

/// `HR Is Watching --render-still <file.jpg>`: render the whole wall's first frame at the
/// photo's size and save it as a JPEG; exit 0 only if that worked. build.sh puts it in the app
/// (the desktop picture) and in the screen saver (under the loading scene).
final class StillRender: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ note: Notification) {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--render-still"), index + 1 < arguments.count else { Self.finish(nil) }
    let file = URL(fileURLWithPath: arguments[index + 1])
    SceneStill.render(root: Bundle.main.resourceURL!.appendingPathComponent("scene"), pixels: SceneStill.wallPixels) { frame in
      guard let frame,
        let data = NSBitmapImageRep(cgImage: frame).representation(using: .jpeg, properties: [.compressionFactor: 0.92]),
        (try? data.write(to: file)) != nil
      else { Self.finish(nil) }
      Self.finish("\(frame.width) x \(frame.height)")
    }
  }

  static func finish(_ size: String?) -> Never {
    print(size.map { "Rendered the still (\($0))" } ?? "Could not render the still")
    exit(size == nil ? 1 : 0)
  }
}
