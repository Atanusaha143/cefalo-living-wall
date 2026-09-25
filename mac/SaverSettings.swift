// The screen saver's own settings, edited in its Options sheet and stored with
// ScreenSaverDefaults under the saver's module name (in legacyScreenSaver's container).
import ScreenSaver

struct SaverSettings {
  static let shared = SaverSettings(module: "local.cefalo-living-wall.saver")
  let module: String

  // Read fresh each time, so a long-running host sees what Options saved elsewhere.
  var motion: Int {
    get { motionLevel(stored: stored()?.object(forKey: "motion") as? Int) }
    nonmutating set { save(newValue, forKey: "motion") }
  }

  /// 0 Off, 1 Drizzle, 2 Steady, 3 Monsoon.
  var rain: Int {
    get { rainMode(stored: stored()?.object(forKey: "rain") as? Int) }
    nonmutating set { save(rainMode(stored: newValue), forKey: "rain") }
  }

  private func stored() -> UserDefaults? { ScreenSaverDefaults(forModuleWithName: module) }

  /// One instance for both calls: ScreenSaverDefaults drops a change that the same instance
  /// never synchronizes.
  private func save(_ value: Any, forKey key: String) {
    let defaults = stored()
    defaults?.set(value, forKey: key)
    defaults?.synchronize()
  }
}
