import Foundation

/// ~/.config/hop/config.json. Profile keys may be the directory ("Profile 5") or the display name ("Personal").
public struct Config: Codable, Equatable {
    public struct ProfileSettings: Codable, Equatable {
        /// Optional direct hotkey, active only while Chrome is frontmost.
        public var hotkey: String?
        /// Override when the window-title suffix differs from what Hop derives.
        public var titleLabel: String?

        public init(hotkey: String? = nil, titleLabel: String? = nil) {
            self.hotkey = hotkey
            self.titleLabel = titleLabel
        }
    }

    public static let defaultPromoteHotkey = "opt+shift+p"
    public static let defaultPreviousProfileHotkey = "cmd+opt+left"
    public static let defaultNextProfileHotkey = "cmd+opt+right"

    /// Mini windows open in the current Chrome profile; this is only the fallback when none can be determined.
    public var miniProfile: String
    public var promoteHotkey: String
    /// Arc-style profile cycling, active only while Chrome is frontmost.
    public var previousProfileHotkey: String?
    public var nextProfileHotkey: String?
    /// Cycle order; profiles not listed are skipped. Defaults to all profiles ("Default" first).
    public var profileOrder: [String]?
    public var profiles: [String: ProfileSettings]

    public init(miniProfile: String = "Default",
                promoteHotkey: String = defaultPromoteHotkey,
                previousProfileHotkey: String? = defaultPreviousProfileHotkey,
                nextProfileHotkey: String? = defaultNextProfileHotkey,
                profileOrder: [String]? = nil,
                profiles: [String: ProfileSettings] = [:]) {
        self.miniProfile = miniProfile
        self.promoteHotkey = promoteHotkey
        self.previousProfileHotkey = previousProfileHotkey
        self.nextProfileHotkey = nextProfileHotkey
        self.profileOrder = profileOrder
        self.profiles = profiles
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        miniProfile = try c.decodeIfPresent(String.self, forKey: .miniProfile) ?? "Default"
        promoteHotkey = try c.decodeIfPresent(String.self, forKey: .promoteHotkey) ?? Self.defaultPromoteHotkey
        // A missing key means default; an explicit null disables the hotkey.
        previousProfileHotkey = c.contains(.previousProfileHotkey)
            ? try c.decodeIfPresent(String.self, forKey: .previousProfileHotkey) : Self.defaultPreviousProfileHotkey
        nextProfileHotkey = c.contains(.nextProfileHotkey)
            ? try c.decodeIfPresent(String.self, forKey: .nextProfileHotkey) : Self.defaultNextProfileHotkey
        profileOrder = try c.decodeIfPresent([String].self, forKey: .profileOrder)
        profiles = try c.decodeIfPresent([String: ProfileSettings].self, forKey: .profiles) ?? [:]
    }

    public static func makeDefault(for profiles: [ChromeProfile]) -> Config {
        Config(miniProfile: profiles.first?.dir ?? "Default")
    }

    public static func resolve(_ key: String, in profiles: [ChromeProfile]) -> ChromeProfile? {
        profiles.first { $0.dir == key } ?? profiles.first { $0.name.caseInsensitiveCompare(key) == .orderedSame }
    }

    public func cycleOrder(_ profiles: [ChromeProfile]) -> [ChromeProfile] {
        guard let profileOrder else { return profiles }
        return profileOrder.compactMap { Self.resolve($0, in: profiles) }
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}
