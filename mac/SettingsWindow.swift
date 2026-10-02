import AppKit

/// Menu ▸ Settings…: the settings set once, each with a line explaining it. Rain, Snow and
/// Motion, changed often, stay in the menu. Built in code, like the rest of the app.
final class SettingsWindow: NSWindowController, NSWindowDelegate {
  static let title = "Cefalo Living Wall Settings"
  let corner = NSPopUpButton(frame: .zero, pullsDown: false)
  let screenSaverButton = NSButton(title: "Screen Saver Options…", target: nil, action: nil)
  private let openScreenSaverSettings: () -> Void

  init(openScreenSaverSettings: @escaping () -> Void) {
    self.openScreenSaverSettings = openScreenSaverSettings
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 460, height: 200), styleMask: [.titled, .closable], backing: .buffered,
      defer: false)
    window.title = Self.title
    window.isReleasedWhenClosed = false
    super.init(window: window)
    window.delegate = self
    corner.addItems(withTitles: liveLockTitles)
    corner.target = self
    corner.action = #selector(chooseCorner)
    screenSaverButton.target = self
    screenSaverButton.action = #selector(openScreenSaver)
    let grid = NSGridView(views: [
      [Self.label("Live Lock Screen"), corner],
      [NSGridCell.emptyContentView, Self.note(
        "Move the pointer into that corner to start the screen saver: with Cefalo Living Wall chosen below for "
          + "each display, your Mac locks behind the moving wall. The power button shows a still photo.")],
      [Self.label("Screen Saver"), screenSaverButton],
      [NSGridCell.emptyContentView, Self.note("Choose Cefalo Living Wall for each display. Its Options… set its own Motion, Rain and Snow.")],
    ])
    grid.column(at: 0).xPlacement = .trailing
    grid.rowAlignment = .firstBaseline
    grid.columnSpacing = 10
    grid.rowSpacing = 6
    grid.row(at: 1).bottomPadding = 14   // room between the two settings
    grid.translatesAutoresizingMaskIntoConstraints = false
    let content = NSView()
    content.addSubview(grid)
    NSLayoutConstraint.activate([
      grid.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
      grid.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
      grid.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
      grid.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -22),
    ])
    window.contentView = content
    content.layoutSubtreeIfNeeded()
    window.setContentSize(content.fittingSize)
    window.center()
    refresh()
  }

  required init?(coder: NSCoder) { nil }

  /// Settings…: opens it, or brings it to the front. The app has no Dock icon, so it activates first.
  func show() {
    NSApp.activate(ignoringOtherApps: true)
    showWindow(nil)
    window?.makeKeyAndOrderFront(nil)
    refresh()
  }

  /// The pop-up shows the corner that starts the screen saver now: it may have changed in System Settings.
  func refresh() {
    corner.selectItem(at: liveLockIndex(actions: DockCorners.read()))
  }

  func windowDidBecomeKey(_ notification: Notification) { refresh() }

  @objc private func chooseCorner() {
    LiveLockScreen.choose(liveLockChoice(at: corner.indexOfSelectedItem), over: window) { [weak self] in self?.refresh() }
  }

  @objc private func openScreenSaver() { openScreenSaverSettings() }

  private static func label(_ text: String) -> NSTextField { NSTextField(labelWithString: text) }

  /// The grey line under a setting.
  private static func note(_ text: String) -> NSTextField {
    let field = NSTextField(wrappingLabelWithString: text)
    field.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
    field.textColor = .secondaryLabelColor
    field.preferredMaxLayoutWidth = 300
    return field
  }
}

/// Choosing the live lock screen's corner: HotCorner.swift decides, DockCorners writes.
enum LiveLockScreen {
  /// nil for Off. A corner used for something else asks first, as a sheet on `window`.
  /// `done` runs once it is settled, changed or not, so the caller can show the result.
  static func choose(_ choice: HotCorner?, over window: NSWindow?, done: @escaping () -> Void) {
    let plan = hotCornerPlan(actions: DockCorners.read(), choose: choice)
    guard !plan.writes.isEmpty else { return done() }
    let apply = {
      DockCorners.write(plan.writes)
      // Remembered so that uninstalling clears only a corner this app set.
      if let choice { UserDefaults.standard.set(choice.rawValue, forKey: "liveLockCorner") }
      else { UserDefaults.standard.removeObject(forKey: "liveLockCorner") }
      log("live lock screen: \(choice?.name ?? "off")")
      done()
    }
    guard let choice, let replaced = plan.replaces else { return apply() }
    let alert = NSAlert()
    alert.messageText = "The \(choice.name) is set to \(replaced). Replace it?"
    alert.informativeText = "Moving the pointer there will start the screen saver instead, and lock your Mac behind the live wall."
    alert.addButton(withTitle: "Replace")
    alert.addButton(withTitle: "Cancel")
    let answer = { (response: NSApplication.ModalResponse) in response == .alertFirstButtonReturn ? apply() : done() }
    if let window { alert.beginSheetModal(for: window, completionHandler: answer) } else { answer(alert.runModal()) }
  }
}

/// `Cefalo Living Wall --check-settings`: build the Settings window without showing it and exit
/// 0 only if it offers Off and the four corners, shows the Dock's corner and has the Screen
/// Saver Options… button. Changes nothing. Used by the installer and mac/tests/run.sh.
final class SettingsCheck: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ note: Notification) {
    let settings = SettingsWindow(openScreenSaverSettings: {})
    let shown = liveLockIndex(actions: DockCorners.read())
    var problems: [String] = []
    if settings.window?.title != SettingsWindow.title { problems.append("the title is \(settings.window?.title ?? "missing")") }
    if settings.corner.itemTitles != liveLockTitles { problems.append("the pop-up offers \(settings.corner.itemTitles)") }
    if settings.corner.indexOfSelectedItem != shown {
      problems.append("the pop-up shows item \(settings.corner.indexOfSelectedItem), the Dock's corner is item \(shown)")
    }
    if settings.screenSaverButton.title != "Screen Saver Options…" || settings.screenSaverButton.action == nil {
      problems.append("the Screen Saver Options… button is missing")
    }
    // Every label, control and explanation is fully inside the window, none cut off.
    if let content = settings.window?.contentView {
      content.layoutSubtreeIfNeeded()
      let grid = content.subviews.first
      for view in grid?.subviews ?? [] where !view.isHidden {
        let frame = view.convert(view.bounds, to: content)
        if !content.bounds.insetBy(dx: -0.5, dy: -0.5).contains(frame) {
          let text = (view as? NSTextField)?.stringValue ?? (view as? NSButton)?.title ?? "\(type(of: view))"
          problems.append("\"\(text.prefix(30))\" runs out of the window (\(Int(frame.maxX)) of \(Int(content.bounds.width)) pt)")
        }
      }
    }
    if problems.isEmpty {
      print("Settings check passed: the window offers Off and four corners, shows \(liveLockTitles[shown]) and the Screen Saver Options… button")
    } else {
      print("Settings check FAILED: \(problems.joined(separator: "; "))")
    }
    exit(problems.isEmpty ? 0 : 1)
  }
}
