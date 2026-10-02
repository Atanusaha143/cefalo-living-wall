import AppKit

/// The menu bar icon: Cefalo's three dots, thin, with two of Apple's leaves (leaf.fill) opening
/// from the bottom dot, one each side, like a seedling, never above the top dot. One colour
/// (a template), so macOS tints it for light and dark menu bars and for the highlight.
enum MenuIcon {
  /// Its size in the menu bar, points.
  static let size = NSSize(width: 29, height: 18)
  /// The grid it is designed in (y down).
  static let grid = NSSize(width: 28, height: 24)
  /// The part of the grid the icon draws, scaled to `size`: the dots and leaves, centred, drawn
  /// 16 pt tall like Maccy's icon beside it, with about 1 pt round them.
  static let viewport = NSRect(x: 0.225, y: 3.45, width: 27.55, height: 17.1)
  static let dots = [NSPoint(x: 14, y: 6.4), NSPoint(x: 14, y: 12), NSPoint(x: 14, y: 17.6)]
  static let dotRadius: CGFloat = 2.0
  /// Place the leaves, each drawn as a 117.2 x 100 box around its outline, in the grid:
  /// narrowed to 70 % across the blade, the left one as Apple draws it and the right one its
  /// mirror image (about the dots' centre line), their stalks' ends on the bottom dot.
  static let leaves = [
    CGAffineTransform(a: 0.09291, b: 0.02121, c: 0.00844, d: 0.08980, tx: 1.21508, ty: 5.45931),
    CGAffineTransform(a: -0.09291, b: 0.02121, c: -0.00844, d: 0.08980, tx: 26.78492, ty: 5.45931),
  ]
  static let leafBox = NSSize(width: 117.2, height: 100)

  /// Nil only if the system has no leaf.fill symbol.
  static func image() -> NSImage? {
    guard let leaf = leaf() else { return nil }
    let image = NSImage(size: size, flipped: true) { _ in
      guard let context = NSGraphicsContext.current?.cgContext else { return false }
      context.scaleBy(x: size.width / viewport.width, y: size.height / viewport.height)
      context.translateBy(x: -viewport.minX, y: -viewport.minY)
      drawMark(in: context, leaf: leaf, dots: [.black, .black, .black], leaves: .black)
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = "HR Is Watching"
    return image
  }

  /// Apple's leaf and where it actually draws inside its image; nil only if the system has no
  /// leaf.fill symbol.
  static func leaf() -> (symbol: NSImage, outline: NSRect)? {
    guard let symbol = NSImage(systemSymbolName: "leaf.fill", accessibilityDescription: nil)?
      .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 64, weight: .regular)),
      let outline = drawnBounds(of: symbol)
    else { return nil }
    return (symbol, outline)
  }

  /// Draws the mark on the grid (y down) into `context`, the current graphics context's: the
  /// leaves in one colour, then the dots, top to bottom, over their stalks. The menu bar icon
  /// draws it all in black; the app icon (AppIcon.swift) in Cefalo's colours.
  static func drawMark(in context: CGContext, leaf: (symbol: NSImage, outline: NSRect), dots colours: [NSColor], leaves colour: NSColor) {
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    for placed in leaves {
      context.saveGState()
      context.concatenate(placed)
      context.scaleBy(x: leafBox.width / leaf.outline.width, y: leafBox.height / leaf.outline.height)
      context.translateBy(x: -leaf.outline.minX, y: -leaf.outline.minY)
      leaf.symbol.draw(in: NSRect(origin: .zero, size: leaf.symbol.size), from: .zero, operation: .sourceOver, fraction: 1,
        respectFlipped: true, hints: nil)
      context.restoreGState()
    }
    // The symbol draws black: this colours what it drew.
    context.setBlendMode(.sourceAtop)
    context.setFillColor(colour.cgColor)
    context.fill(CGRect(origin: .zero, size: grid).insetBy(dx: -grid.width, dy: -grid.height))
    context.endTransparencyLayer()
    for (dot, fill) in zip(dots, colours) {
      fill.setFill()
      NSBezierPath(ovalIn: NSRect(x: dot.x - dotRadius, y: dot.y - dotRadius, width: 2 * dotRadius, height: 2 * dotRadius)).fill()
    }
  }

  /// Where the symbol actually draws inside its image (y down, points): the icon places the
  /// leaf by its outline, not by the symbol's padding.
  static func drawnBounds(of symbol: NSImage) -> NSRect? {
    let k: CGFloat = 4
    guard let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(symbol.size.width * k), pixelsHigh: Int(symbol.size.height * k),
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
      bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    rep.size = symbol.size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    symbol.draw(in: NSRect(origin: .zero, size: symbol.size))
    NSGraphicsContext.restoreGraphicsState()
    var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1
    for y in 0..<rep.pixelsHigh {
      for x in 0..<rep.pixelsWide where (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.05 {
        minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
      }
    }
    guard maxX >= minX, maxY >= minY else { return nil }
    return NSRect(x: CGFloat(minX) / k, y: CGFloat(minY) / k, width: CGFloat(maxX - minX + 1) / k, height: CGFloat(maxY - minY + 1) / k)
  }
}
