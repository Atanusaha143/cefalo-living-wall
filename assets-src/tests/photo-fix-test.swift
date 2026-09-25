// Checks the maths that turns green-wall.jpg into scene/assets/wall.jpg: the ceiling is
// levelled without moving anything else, and the corners are lifted without clipping. A
// plain program (XCTest needs full Xcode):
// swiftc -parse-as-library assets-src/PhotoFix.swift assets-src/tests/photo-fix-test.swift
import Foundation

@main
enum PhotoFixTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static func near(_ a: Double, _ b: Double, _ tolerance: Double = 1e-6) -> Bool { abs(a - b) < tolerance }

  static func main() {
    // Measured on the 3840×2560 photo: the beam's lower edge runs from y=74 (x=0) to
    // y=156.56 (x=3840); the ceiling meets the leaves from y=190 to y=257.2.
    check(near(PhotoFix.outputRow(x: 3840, sourceRow: 156.56), 74), "the beam's right end is lifted level with its left end")
    check(near(PhotoFix.outputRow(x: 3840, sourceRow: 257.2), 190), "so is the ceiling's edge against the leaves")
    check(near(PhotoFix.outputRow(x: 1920, sourceRow: 115.28), 74) && near(PhotoFix.outputRow(x: 1920, sourceRow: 223.6), 190),
      "and both are level in the middle too")
    check([0.0, 50, 74, 150, 190, 500, 2000].allSatisfy { near(PhotoFix.sourceRow(x: 0, y: $0), $0) },
      "the left edge, already level, does not move")
    check([880.0, 1020, 1500, 2559].allSatisfy { near(PhotoFix.sourceRow(x: 3840, y: $0), $0) },
      "nothing moves from just above the logo down: logo, leaves and curb stay put")
    check(near(PhotoFix.sourceRow(x: 3840, y: 0), 82.56), "the top right shows the beam, and the roof above it leaves the frame")

    var folds = 0, outside = 0, drift = 0.0
    for x in stride(from: 0.0, through: 3840, by: 64) {
      var previous = -1.0
      for y in stride(from: 0.0, to: 2560, by: 1) {
        let row = PhotoFix.sourceRow(x: x, y: y)
        if row <= previous { folds += 1 }
        if row < 0 || row > 2559 { outside += 1 }
        drift = max(drift, abs(PhotoFix.outputRow(x: x, sourceRow: row) - y))
        previous = row
      }
    }
    check(folds == 0, "going down the photo always moves down the original (nothing is mirrored or repeated)")
    check(outside == 0, "every row comes from inside the original (no blank edges)")
    check(drift < 1e-6, "outputRow undoes sourceRow, so measured points (the downlights) can be moved with the photo")

    check(near(PhotoFix.cornerGain(x: 1920, y: 1280), 1), "the middle of the photo keeps its brightness")
    check(near(PhotoFix.cornerGain(x: 0, y: 0), 2.2) && near(PhotoFix.cornerGain(x: 3840, y: 2560), 2.2),
      "the corners are lifted the most (2.2×)")
    check(near(PhotoFix.cornerGain(x: 960, y: 640), 1.184669, 1e-5), "halfway to a corner the lift is gentle (1.18×)")
    check(PhotoFix.lift(0, gain: 2) == 0, "black stays black")
    check(near(PhotoFix.lift(1, gain: 2.2), 1), "white stays white, so the logo never clips")
    check(near(PhotoFix.lift(0.01, gain: 2), 0.0198020) && near(PhotoFix.lift(0.5, gain: 2), 2.0 / 3.0),
      "shadows get nearly the full lift, mid-tones less")
    exit(failures == 0 ? 0 : 1)
  }
}
