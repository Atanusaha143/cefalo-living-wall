// How scene/assets/wall.jpg is made from green-wall.jpg (prepare-photo.swift does the file
// work). In pixels of the photo at 3840×2560, y down.
//
// The camera was not square to the ceiling: its front beam and its edge against the
// leaves slope down to the right, while the logo and the curb are level. So only the band
// above the logo is moved, straight up, until both ceiling lines are level with their
// left ends; below `steady` nothing moves. The camera also darkened the corners, which are
// lifted part of the way back.
import Foundation

enum PhotoFix {
  static let width = 3840.0, height = 2560.0
  /// The beam's lower edge and the ceiling's edge against the leaves: y = a + b·x.
  static let beam = (a: 74.0, b: 0.0215), ceiling = (a: 190.0, b: 0.0175)
  /// Rows from here down stay where they are (the logo starts near y=1020).
  static let steady = 880.0
  /// Corner lift: 1 + strength·r^power, r = 0 in the middle and 1 in the corners.
  static let corners = (strength: 1.2, power: 2.7)

  /// Which row of the original an output row shows, at column x.
  static func sourceRow(x: Double, y: Double) -> Double {
    let f = beam.a + beam.b * x, c = ceiling.a + ceiling.b * x
    if y <= beam.a { return y + (f - beam.a) }
    if y <= ceiling.a { return f + (y - beam.a) * (c - f) / (ceiling.a - beam.a) }
    if y < steady { return c + (y - ceiling.a) * (steady - c) / (steady - ceiling.a) }
    return y
  }

  /// Where a row of the original ends up: the inverse of sourceRow.
  static func outputRow(x: Double, sourceRow s: Double) -> Double {
    let f = beam.a + beam.b * x, c = ceiling.a + ceiling.b * x
    if s <= f { return s - (f - beam.a) }
    if s <= c { return beam.a + (s - f) * (ceiling.a - beam.a) / (c - f) }
    if s < steady { return ceiling.a + (s - c) * (steady - ceiling.a) / (steady - c) }
    return s
  }

  /// How much to brighten the original at (x, y), in linear light.
  static func cornerGain(x: Double, y: Double) -> Double {
    let dx = x - width / 2, dy = y - height / 2
    let r = (dx * dx + dy * dy).squareRoot() / (width * width / 4 + height * height / 4).squareRoot()
    return 1 + corners.strength * pow(r, corners.power)
  }

  /// A linear-light value brightened by `gain`, easing off towards white so nothing clips.
  static func lift(_ v: Double, gain: Double) -> Double { v * gain / (1 + v * (gain - 1)) }
}
