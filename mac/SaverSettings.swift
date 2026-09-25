// The screen saver's own settings, edited in its Options sheet and stored with
// ScreenSaverDefaults under the saver's module name (in legacyScreenSaver's container).
import ScreenSaver

struct SaverSettings {
  static let shared = SaverSettings(module: "local.cefalo-living-wall.saver")
  let module: String

  /// Read fresh each time, so a long-running host sees what Options saved elsewhere.
  var motion: Int {
    get { motionLevel(stored: ScreenSaverDefaults(forModuleWithName: module)?.object(forKey: "motion") as? Int) }
    nonmutating set {
      // One instance for both calls: ScreenSaverDefaults drops a change that the same
      // instance never synchronizes.
      let defaults = ScreenSaverDefaults(forModuleWithName: module)
      defaults?.set(newValue, forKey: "motion")
      defaults?.synchronize()
    }
  }
}
