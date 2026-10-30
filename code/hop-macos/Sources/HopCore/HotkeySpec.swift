import Foundation

/// A hotkey written as text in config.json, e.g. "opt+space", "cmd+opt+right", "ctrl+shift+p".
public struct HotkeySpec: Equatable, Sendable, CustomStringConvertible {
    public var command = false
    public var option = false
    public var control = false
    public var shift = false
    /// Lowercased key: a single character or one of `namedKeys`.
    public var key: String

    public static let namedKeys: Set<String> = Set([
        "space", "return", "enter", "tab", "escape", "esc", "delete", "left", "right", "up", "down",
    ]).union((1...12).map { "f\($0)" })

    public init(key: String, command: Bool = false, option: Bool = false, control: Bool = false, shift: Bool = false) {
        self.key = key
        self.command = command
        self.option = option
        self.control = control
        self.shift = shift
    }

    public static func parse(_ string: String) -> HotkeySpec? {
        let parts = string.lowercased().split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let key = parts.last, key.count == 1 || namedKeys.contains(key) else { return nil }
        var spec = HotkeySpec(key: key)
        for modifier in parts.dropLast() {
            switch modifier {
            case "cmd", "command", "⌘": spec.command = true
            case "opt", "option", "alt", "⌥": spec.option = true
            case "ctrl", "control", "⌃": spec.control = true
            case "shift", "⇧": spec.shift = true
            default: return nil
            }
        }
        return spec
    }

    public var description: String {
        var s = ""
        if control { s += "⌃" }
        if option { s += "⌥" }
        if shift { s += "⇧" }
        if command { s += "⌘" }
        let glyphs = ["space": "Space", "return": "↩", "enter": "↩", "tab": "⇥", "escape": "⎋", "esc": "⎋",
                      "delete": "⌫", "left": "←", "right": "→", "up": "↑", "down": "↓"]
        return s + (glyphs[key] ?? key.uppercased())
    }
}
