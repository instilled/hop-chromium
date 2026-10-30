import Carbon
import HopCore

/// Global hotkeys via Carbon RegisterEventHotKey. Needs no Input Monitoring permission.
final class HotkeyCenter {
    static let shared = HotkeyCenter()

    enum HotkeyError: LocalizedError {
        case invalid(String), unknownKey(String), unavailable(String)
        var errorDescription: String? {
            switch self {
            case .invalid(let s): "Invalid hotkey \"\(s)\""
            case .unknownKey(let s): "No key on this keyboard layout for \"\(s)\""
            case .unavailable(let s): "Hotkey \"\(s)\" is already taken by another app"
            }
        }
    }

    private var actions: [UInt32: () -> Void] = [:]
    private var refs: [UInt32: EventHotKeyRef] = [:]
    private var nextID: UInt32 = 1
    private var layout = KeyCodes.layoutMap()

    private init() {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
            var hotkey = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                           nil, MemoryLayout<EventHotKeyID>.size, nil, &hotkey)
            guard status == noErr else { return status }
            let id = hotkey.id
            DispatchQueue.main.async { HotkeyCenter.shared.actions[id]?() }
            return noErr
        }, 1, &type, nil, nil)
    }

    func reloadKeyboardLayout() { layout = KeyCodes.layoutMap() }

    @discardableResult
    func register(_ string: String, action: @escaping () -> Void) throws -> UInt32 {
        guard let spec = HotkeySpec.parse(string) else { throw HotkeyError.invalid(string) }
        guard let code = KeyCodes.code(for: spec.key, layout: layout) else { throw HotkeyError.unknownKey(string) }
        var modifiers: UInt32 = 0
        if spec.command { modifiers |= UInt32(cmdKey) }
        if spec.option { modifiers |= UInt32(optionKey) }
        if spec.control { modifiers |= UInt32(controlKey) }
        if spec.shift { modifiers |= UInt32(shiftKey) }

        let id = nextID
        nextID += 1
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(code, modifiers, EventHotKeyID(signature: 0x434B_6579 /* 'CKey' */, id: id),
                                         GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { throw HotkeyError.unavailable(string) }
        refs[id] = ref
        actions[id] = action
        return id
    }

    func unregister(_ ids: [UInt32]) {
        for id in ids {
            if let ref = refs.removeValue(forKey: id) { UnregisterEventHotKey(ref) }
            actions[id] = nil
        }
    }
}

enum KeyCodes {
    static let named: [String: Int] = [
        "space": kVK_Space, "return": kVK_Return, "enter": kVK_Return, "tab": kVK_Tab,
        "escape": kVK_Escape, "esc": kVK_Escape, "delete": kVK_Delete,
        "left": kVK_LeftArrow, "right": kVK_RightArrow, "up": kVK_UpArrow, "down": kVK_DownArrow,
        "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
        "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12,
    ]

    /// US-ANSI fallback when the current layout can't be read.
    static let ansi: [Character: Int] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
        "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
        "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
        "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
        ".": 47, "`": 50,
    ]

    static func code(for key: String, layout: [Character: UInt32]) -> UInt32? {
        if let code = named[key] { return UInt32(code) }
        guard key.count == 1, let ch = key.first else { return nil }
        return layout[ch] ?? ansi[ch].map(UInt32.init)
    }

    /// Character → key code for the active keyboard layout, so "opt+z" means the Z key on QWERTZ too.
    static func layoutMap() -> [Character: UInt32] {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return [:] }
        let data = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data
        var map: [Character: UInt32] = [:]
        data.withUnsafeBytes { buffer in
            guard let layout = buffer.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return }
            for code in 0..<128 {
                var dead: UInt32 = 0
                var length = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let status = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDisplay), 0, UInt32(LMGetKbdType()),
                                            OptionBits(kUCKeyTranslateNoDeadKeysMask), &dead, chars.count, &length, &chars)
                guard status == noErr, length > 0,
                      let ch = String(utf16CodeUnits: chars, count: length).lowercased().first,
                      map[ch] == nil else { continue }
                map[ch] = UInt32(code)
            }
        }
        return map
    }
}
