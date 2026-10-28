import AppKit
import ApplicationServices
import HopCore
import SwiftUI

@main
struct HopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @ObservedObject private var model = AppModel.shared

    var body: some Scene {
        MenuBarExtra("Hop", systemImage: "smallcircle.filled.circle") {
            MenuContent(model: model)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        // Registered before launch completes so the link that launched us isn't lost.
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleGetURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
        AppModel.shared.start()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !AXIsProcessTrusted() { askForAccessibility() }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        urls.forEach(AppModel.shared.handle(url:))
    }

    @objc private func handleGetURL(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
        guard let string = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: string) else { return }
        AppModel.shared.handle(url: url)
    }

    private func askForAccessibility() {
        NSApp.activate()
        let alert = NSAlert()
        alert.messageText = "Hop needs Accessibility access"
        alert.informativeText = """
        Hop uses Accessibility to find, raise and close Chrome windows, and to read the URL of a \
        mini window when you promote it. It does not monitor your typing.

        Click Continue, then turn on Hop in System Settings → Privacy & Security → Accessibility. \
        No restart needed.
        """
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            AppModel.shared.requestAccessibility()
        }
    }
}

private struct MenuContent: View {
    @ObservedObject var model: AppModel

    var body: some View {
        let current = model.currentProfile
        if model.profiles.isEmpty {
            Text("No profiles")
        }
        // Checkmark = current profile, where mini windows open.
        ForEach(model.profiles) { profile in
            Toggle(profile.name, isOn: Binding(get: { profile.dir == current.dir }, set: { _ in model.focus(profile) }))
                .shortcut(model.profileHotkey(profile))
        }

        Divider()
        Button("Previous Profile") { model.cycleProfile(-1) }
            .shortcut(model.config.previousProfileHotkey)
        Button("Next Profile") { model.cycleProfile(1) }
            .shortcut(model.config.nextProfileHotkey)
        Button("Promote to Tab") { model.promote() }
            .shortcut(model.config.promoteHotkey)

        if !model.axTrusted || !model.errors.isEmpty || model.status != nil {
            Divider()
        }
        if !model.axTrusted {
            Button("Grant Accessibility…") { model.requestAccessibility() }
        }
        if !model.errors.isEmpty {
            Menu("Config Problems (\(model.errors.count))") {
                ForEach(model.errors, id: \.self) { Text($0) }
            }
        }
        if let status = model.status {
            Text(status)
        }

        Divider()
        Toggle("Open Links in Mini Window", isOn: Binding(get: { model.opensLinksInMini }, set: { model.setOpensLinksInMini($0) }))
        Toggle("Launch at Login", isOn: Binding(get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) }))
        Button("Set as Default Browser…") { model.setDefaultBrowser() }
        Button("Reload Config") { model.reload() }
        Button("Open Config") { model.openConfig() }

        Divider()
        Button("Quit") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}

private extension View {
    /// Shows a config hotkey as the menu item's native key equivalent.
    @ViewBuilder
    func shortcut(_ hotkey: String?) -> some View {
        if let spec = hotkey.flatMap(HotkeySpec.parse), let key = spec.keyEquivalent {
            keyboardShortcut(key, modifiers: spec.eventModifiers)
        } else {
            self
        }
    }
}

private extension HotkeySpec {
    var eventModifiers: EventModifiers {
        var modifiers: EventModifiers = []
        if command { modifiers.insert(.command) }
        if option { modifiers.insert(.option) }
        if control { modifiers.insert(.control) }
        if shift { modifiers.insert(.shift) }
        return modifiers
    }

    var keyEquivalent: KeyEquivalent? {
        switch key {
        case "left": .leftArrow
        case "right": .rightArrow
        case "up": .upArrow
        case "down": .downArrow
        case "space": .space
        case "return", "enter": .return
        case "tab": .tab
        case "escape", "esc": .escape
        case "delete": .delete
        default: key.count == 1 ? KeyEquivalent(Character(key)) : nil
        }
    }
}
