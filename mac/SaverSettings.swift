// The screen saver's own settings, edited in its Options sheet and stored with
// ScreenSaverDefaults under the saver's module name (in legacyScreenSaver's container).
import ScreenSaver

struct SaverSettings {
  static let shared = SaverSettings(module: "local.hr-is-watching.saver")
  let module: String

  // Read fresh each time, so a long-running host sees what Options saved elsewhere.
  var motion: Int {
    get { motionLevel(stored: stored()?.object(forKey: "motion") as? Int) }
    nonmutating set { save(newValue, forKey: "motion") }
  }

  /// Off, or the one weather and its mode: stored as one value ("snow:2"); before there was one,
  /// the Rain mode earlier versions stored carries over.
  var weather: WeatherChoice {
    get {
      let defaults = stored()
      return weatherChoice(stored: defaults?.string(forKey: "weather"), legacyRain: defaults?.object(forKey: "rain") as? Int)
    }
    nonmutating set { save(newValue.stored, forKey: "weather") }
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
