// Checks the app's icon: the menu bar icon's mark in Cefalo's colours on a white tile, laid out
// on Apple's grid for macOS icons. A plain program:
// swiftc -parse-as-library mac/MenuIcon.swift mac/AppIcon.swift mac/tests/app-icon-test.swift
// It reads the 1024 px icon's pixels on that grid (y down).
import AppKit

@main
enum AppIconTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  typealias Pixel = (r: Int, g: Int, b: Int, a: CGFloat)
  /// The pixel's own bytes (premultiplied), as drawn in sRGB: reading them through NSColor
  /// converts them.
  static func pixel(_ rep: NSBitmapImageRep, _ p: CGPoint) -> Pixel {
    var v = [Int](repeating: 0, count: 4)
    rep.getPixel(&v, atX: Int(p.x), y: Int(p.y))
    return (v[0], v[1], v[2], CGFloat(v[3]) / 255)
  }
  /// Within one step of a colour written as in the logo's SVG ("#57A11F").
  static func matches(_ p: Pixel, _ hex: String) -> Bool {
    let v = Int(hex.dropFirst(), radix: 16)!
    return p.a > 0.99 && abs(p.r - (v >> 16)) <= 1 && abs(p.g - (v >> 8 & 0xFF)) <= 1 && abs(p.b - (v & 0xFF)) <= 1
  }

  static func main() {
    guard let icon = AppIcon.image(pixels: 1024) else {
      check(false, "the icon draws (Apple's leaf.fill symbol is available)")
      exit(1)
    }
    check(icon.width == 1024 && icon.height == 1024, "it draws 1024 px square, the largest size macOS asks for")
    check(icon.colorSpace?.name == CGColorSpace.sRGB, "in sRGB, so Cefalo's colours come out exactly as its logo has them")
    let rep = NSBitmapImageRep(cgImage: icon)

    // Cefalo's colours, as its logo on cefalo.com has them (hubfs/logo/logo-color.svg).
    let (dots, r) = (MenuIcon.dots, MenuIcon.dotRadius)
    let centres = dots.map { $0.applying(AppIcon.mark) }
    check(zip(centres, ["#57A11F", "#00A9DC", "#004081"]).allSatisfy { matches(pixel(rep, $0), $1) },
      "the dots are Cefalo's green, light blue and navy, top to bottom, as in its logo: \(centres.map { pixel(rep, $0) })")

    // The leaves: the ink either side of the dots, on the tile, in the rows the mark can reach
    // (its viewport is 343 px tall), each against the tile's colour well clear of the mark.
    let scale = AppIcon.mark.a, column = (centres[0].x - (r + 0.6) * scale, centres[0].x + (r + 0.6) * scale)
    var green = (left: 0, right: 0), other = 0, ink = (minX: CGFloat.infinity, maxX: -CGFloat.infinity, minY: CGFloat.infinity, maxY: -CGFloat.infinity)
    for y in stride(from: 300, to: 724, by: 1) {
      let tile = pixel(rep, CGPoint(x: 150, y: y))
      for x in stride(from: 110, to: 914, by: 1) {
        let p = pixel(rep, CGPoint(x: x, y: y))
        guard p.a > 0.99, abs(p.r - tile.r) + abs(p.g - tile.g) + abs(p.b - tile.b) > 60 else { continue }
        let (fx, fy) = (CGFloat(x), CGFloat(y))
        ink = (min(ink.minX, fx), max(ink.maxX, fx + 1), min(ink.minY, fy), max(ink.maxY, fy + 1))
        guard fx < column.0 || fx > column.1 else { continue }
        if matches(p, "#57A11F") { if fx < column.0 { green.left += 1 } else { green.right += 1 } }
        else if !(p.g > p.r && p.g > p.b) { other += 1 }
      }
    }
    let area = Int(15 * scale * scale)   // as the menu icon's test: over 15 square units of its grid
    check(green.left > area && green.right > area, "a green leaf grows out to each side (\(green.left) and \(green.right) px)")
    check(abs(green.left - green.right) < max(green.left, green.right) / 50, "the two leaves mirror each other")
    check(other == 0, "the leaves are Cefalo's green, blended only into the tile at their edges (\(other) px of another colour)")
    let width = (ink.maxX - ink.minX) / AppIcon.tile.width
    check(abs((ink.minX + ink.maxX) / 2 - 512) <= 2, "the mark is centred across the tile: \(ink.minX)...\(ink.maxX)")
    check(abs((ink.minY + ink.maxY) / 2 - 512) <= 16, "and up and down: \(ink.minY)...\(ink.maxY)")
    check(width > 0.6 && width < 0.7, "it spans about two thirds of the tile's width: \(width)")

    // The tile: white, fading slightly towards the bottom; Apple's 824 px rounded square on the
    // 1024 px canvas, with a soft shadow under it and nothing outside.
    let top = pixel(rep, CGPoint(x: 512, y: 130)), bottom = pixel(rep, CGPoint(x: 512, y: 900))
    check(top.a > 0.99 && min(top.r, top.g, top.b) >= 253, "the tile is white: \(top)")
    check(bottom.a > 0.99 && min(bottom.r, bottom.g, bottom.b) >= 225 && bottom.g + bottom.r + bottom.b < top.r + top.g + top.b,
      "fading slightly towards the bottom: \(bottom)")
    let alpha = { (x: CGFloat, y: CGFloat) in pixel(rep, CGPoint(x: x, y: y)).a }
    check([alpha(512, 101), alpha(101, 512), alpha(922, 512), alpha(512, 922)].allSatisfy { $0 > 0.99 }
      && [alpha(512, 96), alpha(96, 512), alpha(927, 512)].allSatisfy { $0 < 0.3 },
      "the tile is Apple's 824 px square, 100 px in from each side")
    check(alpha(116, 116) < 0.05 && alpha(907, 116) < 0.05, "with rounded corners: nothing drawn outside them")
    check(alpha(4, 4) == 0 && alpha(1019, 4) == 0 && alpha(512, 80) < 0.02, "and nothing round it at the top")
    let shadow = pixel(rep, CGPoint(x: 512, y: 935))
    check(shadow.a > 0.05 && shadow.a < 0.5 && max(shadow.r, shadow.g, shadow.b) < 60, "but a soft shadow under it: \(shadow)")

    // Every size an .iconset holds, for iconutil.
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("app-icon-test-\(getpid()).iconset")
    defer { try? FileManager.default.removeItem(at: folder) }
    check(AppIcon.writeIconset(to: folder), "it writes an .iconset")
    let expected = [16, 32, 128, 256, 512].flatMap { ["icon_\($0)x\($0).png": $0, "icon_\($0)x\($0)@2x.png": 2 * $0] }
    let written = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    check(Set(written) == Set(expected.map(\.key)), "with the ten files iconutil expects: \(written.sorted())")
    check(expected.allSatisfy { name, pixels in
      NSBitmapImageRep(data: (try? Data(contentsOf: folder.appendingPathComponent(name))) ?? Data()).map {
        $0.pixelsWide == pixels && $0.pixelsHigh == pixels
      } ?? false
    }, "each one its own size, 16 to 1024 px")

    if failures > 0 {
      print("\(failures) failed")
      exit(1)
    }
  }
}
