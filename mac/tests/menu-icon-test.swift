// Checks the menu bar icon: Cefalo's three dots with two of Apple's leaves opening from the bottom one.
// A plain program: swiftc -parse-as-library mac/MenuIcon.swift mac/tests/menu-icon-test.swift
// It draws the icon at 8x and reads its pixels in the design grid (28 x 24, y down).
import AppKit

@main
enum MenuIconTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static let scale: CGFloat = 8
  /// The icon's opacity (0...1) at a point of the design grid.
  static func alpha(_ rep: NSBitmapImageRep, _ x: CGFloat, _ y: CGFloat) -> CGFloat {
    let v = MenuIcon.viewport, k = scale * MenuIcon.size.width / v.width
    let px = Int((x - v.minX) * k), py = Int((y - v.minY) * k)
    guard px >= 0, py >= 0, px < rep.pixelsWide, py < rep.pixelsHigh else { return 0 }
    return rep.colorAt(x: px, y: py)?.alphaComponent ?? 0
  }

  static func render(_ image: NSImage) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(image.size.width * scale), pixelsHigh: Int(image.size.height * scale),
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
      bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = image.size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(origin: .zero, size: image.size))
    NSGraphicsContext.restoreGraphicsState()
    return rep
  }

  static func main() {
    guard let image = MenuIcon.image() else {
      check(false, "the icon draws (Apple's leaf.fill symbol is available)")
      exit(1)
    }
    check(image.size == NSSize(width: 29, height: 18), "the icon is 29 x 18 pt: wide enough for a leaf each side")
    check(image.isTemplate, "it is a template, so macOS tints it for light and dark menu bars and the highlight")
    check(image.accessibilityDescription == "Cefalo Living Wall", "VoiceOver calls it Cefalo Living Wall")

    let rep = render(image)
    let (dots, r) = (MenuIcon.dots, MenuIcon.dotRadius)
    check(dots.count == 3 && dots.allSatisfy { $0.x == dots[0].x && alpha(rep, $0.x, $0.y) > 0.9 }, "three solid dots in a column, like Cefalo's logo")
    check(r <= 2.0 && alpha(rep, dots[0].x + r + 0.3, dots[0].y) < 0.5 && alpha(rep, dots[0].x - r - 0.3, dots[0].y) < 0.5,
      "thin dots: \(r) across the grid's 2.6 before")
    let between = [(dots[0].y + dots[1].y) / 2, (dots[1].y + dots[2].y) / 2]
    check(between.allSatisfy { alpha(rep, dots[0].x, $0) < 0.5 }, "the dots stay apart")

    // The leaves: everything left and right of the dots. And the whole drawing's extent, in points.
    let (leftEdge, rightEdge) = (dots[0].x - r - 0.6, dots[0].x + r + 0.6)
    var top = CGFloat.infinity, leftArea: CGFloat = 0, rightArea: CGFloat = 0
    var ink = (minX: CGFloat.infinity, minY: CGFloat.infinity, maxX: -CGFloat.infinity, maxY: -CGFloat.infinity)
    let v = MenuIcon.viewport, unit = v.width / CGFloat(rep.pixelsWide), point = 1 / scale
    for py in 0..<rep.pixelsHigh {
      for px in 0..<rep.pixelsWide where (rep.colorAt(x: px, y: py)?.alphaComponent ?? 0) > 0.5 {
        ink = (min(ink.minX, CGFloat(px)), min(ink.minY, CGFloat(py)), max(ink.maxX, CGFloat(px + 1)), max(ink.maxY, CGFloat(py + 1)))
        let (x, y) = (v.minX + (CGFloat(px) + 0.5) * unit, v.minY + (CGFloat(py) + 0.5) * unit)
        if x < leftEdge { leftArea += unit * unit; top = min(top, y) }
        if x > rightEdge { rightArea += unit * unit; top = min(top, y) }
      }
    }
    check(leftArea > 15 && rightArea > 15, "a leaf grows out to each side (\(Int(leftArea)) and \(Int(rightArea)) square units)")
    check(abs(leftArea - rightArea) < 0.1 * max(leftArea, rightArea), "the two leaves mirror each other")
    check(top >= dots[0].y - r - 0.2, "no leaf rises above the top dot (leaves' top \(top), dot top \(dots[0].y - r))")
    let (inkWidth, inkHeight) = ((ink.maxX - ink.minX) * point, (ink.maxY - ink.minY) * point)
    check(abs(inkHeight - 16) <= 0.15, "it stands exactly as tall as Maccy's icon beside it, 16 pt: \(inkHeight) pt of 18")
    let margins = [ink.minX * point, ink.minY * point, image.size.width - ink.maxX * point, image.size.height - ink.maxY * point]
    check(margins.allSatisfy { $0 >= 0.4 && $0 <= 1.6 }, "with only a thin margin all round: \(margins.map { (($0 * 10).rounded() / 10) }) pt, \(inkWidth) pt wide")

    // Both grow from the bottom dot only: a gap round the top and middle dots' sides, and ink
    // leaving the bottom dot towards the upper left and the upper right (the stalks).
    let ring = { (c: NSPoint, d: CGFloat, degrees: ClosedRange<Int>) in
      stride(from: degrees.lowerBound, through: degrees.upperBound, by: 5).map { deg -> CGFloat in
        let a = CGFloat(deg) * .pi / 180
        return alpha(rep, c.x + d * cos(a), c.y + d * sin(a))
      }
    }
    check((ring(dots[1], r + 0.3, -80...80) + ring(dots[1], r + 0.3, 100...260)).allSatisfy { $0 < 0.5 },
      "the leaves do not touch the middle dot")
    check((ring(dots[0], r + 0.3, -80...80) + ring(dots[0], r + 0.3, 100...260)).allSatisfy { $0 < 0.5 },
      "nor the top dot")
    check(ring(dots[2], r + 0.4, -80...0).contains { $0 > 0.5 } && ring(dots[2], r + 0.4, 180...260).contains { $0 > 0.5 },
      "their stalks grow out of the bottom dot, one each side")

    if failures > 0 {
      print("\(failures) failed")
      exit(1)
    }
  }
}
