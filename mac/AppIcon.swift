import AppKit

/// The app's icon: the menu bar icon's mark in Cefalo's colours (the dots green, light blue and
/// navy, top to bottom, as in its logo, and the leaves its green) on a white tile. Laid out on
/// Apple's grid for macOS icons: an 824 px rounded square in the middle of a 1024 px canvas,
/// with a soft shadow under it, so macOS 26 shows it as it is rather than inside a grey tile.
/// build.sh renders it (`--render-icon`) and iconutil makes AppIcon.icns of it.
///
/// The leaves are Apple's leaf.fill, drawn from this Mac's own symbols: Apple's terms do not
/// allow its symbols in app icons, so they must be replaced before the app is shared publicly.
enum AppIcon {
  /// Cefalo's colours, as its logo on cefalo.com has them (hubfs/logo/logo-color.svg).
  static let green = NSColor(srgbRed: 0x57 / 255.0, green: 0xA1 / 255.0, blue: 0x1F / 255.0, alpha: 1)
  static let lightBlue = NSColor(srgbRed: 0x00 / 255.0, green: 0xA9 / 255.0, blue: 0xDC / 255.0, alpha: 1)
  static let navy = NSColor(srgbRed: 0x00 / 255.0, green: 0x40 / 255.0, blue: 0x81 / 255.0, alpha: 1)

  /// Apple's grid (y down): the canvas, and the rounded square on it.
  static let canvas: CGFloat = 1024
  static let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
  static let cornerRadius: CGFloat = 185.4
  /// How much of the tile's width the menu icon's viewport spans.
  static let markWidth: CGFloat = 0.67
  /// From the menu icon's grid to the canvas: the mark centred on the tile.
  static var mark: CGAffineTransform {
    let v = MenuIcon.viewport, s = tile.width * markWidth / v.width
    return CGAffineTransform(a: s, b: 0, c: 0, d: s, tx: tile.midX - v.midX * s, ty: tile.midY - v.midY * s)
  }

  /// The icon, `pixels` square, in sRGB; nil only if the system has no leaf.fill symbol.
  static func image(pixels: Int) -> CGImage? {
    guard let leaf = MenuIcon.leaf(), let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let k = CGFloat(pixels) / canvas
    context.translateBy(x: 0, y: CGFloat(pixels))
    context.scaleBy(x: k, y: -k)
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)

    let shape = roundedSquare(tile, radius: cornerRadius)
    context.saveGState()
    // Shadows are set in pixels, y up.
    context.setShadow(offset: CGSize(width: 0, height: -10 * k), blur: 20 * k, color: NSColor.black.withAlphaComponent(0.28).cgColor)
    context.addPath(shape)
    context.setFillColor(NSColor.white.cgColor)
    context.fillPath()
    context.restoreGState()
    context.saveGState()
    context.addPath(shape)
    context.clip()
    let fade = [NSColor.white.cgColor, NSColor(srgbRed: 0.93, green: 0.945, blue: 0.925, alpha: 1).cgColor] as CFArray
    if let gradient = CGGradient(colorsSpace: space, colors: fade, locations: [0, 1]) {
      context.drawLinearGradient(gradient, start: CGPoint(x: tile.midX, y: tile.minY), end: CGPoint(x: tile.midX, y: tile.maxY), options: [])
    }
    context.restoreGState()
    context.concatenate(mark)
    MenuIcon.drawMark(in: context, leaf: leaf, dots: [green, lightBlue, navy], leaves: green)
    return context.makeImage()
  }

  /// Every size an .iconset holds (16 to 512 pt, each at 1x and 2x), as PNGs in `folder`.
  static func writeIconset(to folder: URL) -> Bool {
    guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else { return false }
    return [16, 32, 128, 256, 512].allSatisfy { points in
      [("icon_\(points)x\(points).png", points), ("icon_\(points)x\(points)@2x.png", 2 * points)].allSatisfy { name, pixels in
        guard let image = image(pixels: pixels),
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else { return false }
        return (try? png.write(to: folder.appendingPathComponent(name))) != nil
      }
    }
  }

  /// A rounded square with Apple's continuous corners, which ease into the sides rather than
  /// meeting them in a circle's arc.
  static func roundedSquare(_ rect: CGRect, radius r: CGFloat) -> CGPath {
    let path = CGMutablePath()
    // Each corner, clockwise from the top right: the corner, the way back along the side into
    // it, and the way along the side out of it.
    let corners = [
      (CGPoint(x: rect.maxX, y: rect.minY), CGVector(dx: -1, dy: 0), CGVector(dx: 0, dy: 1)),
      (CGPoint(x: rect.maxX, y: rect.maxY), CGVector(dx: 0, dy: -1), CGVector(dx: -1, dy: 0)),
      (CGPoint(x: rect.minX, y: rect.maxY), CGVector(dx: 1, dy: 0), CGVector(dx: 0, dy: -1)),
      (CGPoint(x: rect.minX, y: rect.minY), CGVector(dx: 0, dy: 1), CGVector(dx: 1, dy: 0)),
    ]
    for (i, (corner, back, out)) in corners.enumerated() {
      let at = { (a: CGFloat, b: CGFloat) in
        CGPoint(x: corner.x + (back.dx * a + out.dx * b) * r, y: corner.y + (back.dy * a + out.dy * b) * r)
      }
      if i == 0 { path.move(to: at(1.52866483, 0)) } else { path.addLine(to: at(1.52866483, 0)) }
      path.addCurve(to: at(0.66993427, 0.06549600), control1: at(1.08849323, 0), control2: at(0.86840689, 0))
      path.addLine(to: at(0.63149399, 0.07491100))
      path.addCurve(to: at(0.07491100, 0.63149399), control1: at(0.37282392, 0.16905899), control2: at(0.16905899, 0.37282392))
      path.addLine(to: at(0.06549600, 0.66993427))
      path.addCurve(to: at(0, 1.52866483), control1: at(0, 0.86840689), control2: at(0, 1.08849323))
    }
    path.closeSubpath()
    return path
  }
}
