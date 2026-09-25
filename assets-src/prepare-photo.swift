// Makes scene/assets/wall.jpg from green-wall.jpg: scaled to 3840×2560, the ceiling
// levelled and the corners lifted (the maths is in PhotoFix.swift). Then prints where the
// downlights ended up, for LIGHTS in scene/src/wall.js. Run it with prepare-photo.sh.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
enum PreparePhoto {
  /// The downlights' centres on the unlevelled photo (the middle of their brightest
  /// pixels), in wall units (1600 wide).
  static let measuredLights: [(Double, Double)] = [(260, 58), (531, 61), (798, 65), (1069, 74), (1331, 83), (1595, 86)]

  static func main() {
    let args = CommandLine.arguments
    guard args.count == 3 else {
      print("usage: prepare-photo <green-wall.jpg> <wall.jpg>")
      exit(2)
    }
    let w = Int(PhotoFix.width), h = Int(PhotoFix.height)
    let original = scaled(load(URL(fileURLWithPath: args[1])), width: w, height: h)
    var fixed = [UInt8](repeating: 255, count: w * h * 4)
    for y in 0..<h {
      for x in 0..<w {
        // Straight up or down only: blend the two original rows around the source row.
        let row = min(Double(h - 1), max(0, PhotoFix.sourceRow(x: Double(x), y: Double(y))))
        let r0 = Int(row), r1 = min(h - 1, r0 + 1), t = row - Double(r0)
        let gain = PhotoFix.cornerGain(x: Double(x), y: row)
        for channel in 0..<3 {
          let a = toLinear[Int(original[(r0 * w + x) * 4 + channel])]
          let b = toLinear[Int(original[(r1 * w + x) * 4 + channel])]
          fixed[(y * w + x) * 4 + channel] = toSRGB(PhotoFix.lift(a + (b - a) * t, gain: gain))
        }
      }
    }
    write(fixed, width: w, height: h, to: URL(fileURLWithPath: args[2]))
    let unit = PhotoFix.width / 1600
    let lights = measuredLights.map { x, y in
      "[\(Int(x.rounded())), \(Int((PhotoFix.outputRow(x: x * unit, sourceRow: y * unit) / unit).rounded()))]"
    }
    print("Wrote \(args[2])")
    print("LIGHTS = [\(lights.joined(separator: ", "))]")
  }

  static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
  static let toLinear: [Double] = (0..<256).map { i in
    let v = Double(i) / 255
    return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
  }

  static func toSRGB(_ v: Double) -> UInt8 {
    let c = min(1, max(0, v))
    let s = c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
    return UInt8((s * 255).rounded())
  }

  static func load(_ url: URL) -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
      print("could not read \(url.path)")
      exit(1)
    }
    return image
  }

  /// RGBA bytes, sRGB, top row first.
  static func scaled(_ image: CGImage, width: Int, height: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let context = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                            space: sRGB, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return bytes
  }

  static func write(_ bytes: [UInt8], width: Int, height: Int, to url: URL) {
    var copy = bytes
    let context = CGContext(data: &copy, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                            space: sRGB, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
      print("could not write \(url.path)")
      exit(1)
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      print("could not write \(url.path)")
      exit(1)
    }
  }
}
