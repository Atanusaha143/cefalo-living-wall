import CoreGraphics

/// How much of a screen no app window covers, from 0 (none of it) to 1 (all of it).
/// `screen` and `blockers` are in global CoreGraphics coordinates (top-left origin).
/// The screen is sampled on a grid, so overlapping windows are counted once.
func visibleFraction(of screen: CGRect, blockers: [CGRect], columns: Int = 32, rows: Int = 20) -> Double {
  let relevant = blockers.filter { $0.intersects(screen) }
  guard !relevant.isEmpty else { return 1 }
  var free = 0
  for column in 0..<columns {
    for row in 0..<rows {
      let point = CGPoint(
        x: screen.minX + screen.width * (Double(column) + 0.5) / Double(columns),
        y: screen.minY + screen.height * (Double(row) + 0.5) / Double(rows))
      if !relevant.contains(where: { $0.contains(point) }) { free += 1 }
    }
  }
  return Double(free) / Double(columns * rows)
}

/// The frame-rate cap for a screen whose desktop is this visible.
func frameCap(visible: Double) -> Int {
  visible >= 0.40 ? 30 : visible >= 0.05 ? 15 : 0
}
