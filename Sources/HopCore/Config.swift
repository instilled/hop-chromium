import Foundation

/// ~/.config/hop/config.json. Profile keys may be the directory ("Profile 5") or the display name ("Personal").
public struct Config: Codable, Equatable {
    public struct ProfileSettings: Codable, Equatable {
        /// Optional direct hotkey, active only while Chrome is frontmost.
        public var hotkey: String?
        /// Override when the window-title suffix differs from what Hop derives.
        public var titleLabel: String?
        /// Display name, written by `hop --sync-profiles` for when Hop can't read Local State.
        public var name: String?

        public init(hotkey: String? = nil, titleLabel: String? = nil, name: String? = nil) {
            self.hotkey = hotkey
            self.titleLabel = titleLabel
            self.name = name
        }
    }

    public static let defaultURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/hop/config.json")

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

    /// Profiles as declared in the config, for when Local State is unreadable. Keys are taken as directories.
    public func declaredProfiles() -> [ChromeProfile] {
        profiles.compactMap { dir, settings in
            guard let name = settings.name else { return nil }
            return ChromeProfile(dir: dir, name: name, titleLabel: settings.titleLabel ?? name)
        }
        .sorted(by: LocalState.profileOrder)
    }

    /// Records each discovered profile's name and title label, keeping hotkeys and label overrides.
    public func syncing(_ discovered: [ChromeProfile]) -> Config {
        var copy = self
        for profile in discovered {
            let key = profiles.keys.first { Self.resolve($0, in: [profile]) != nil } ?? profile.dir
            var settings = copy.profiles.removeValue(forKey: key) ?? ProfileSettings()
            settings.name = profile.name
            settings.titleLabel = settings.titleLabel ?? profile.titleLabel
            copy.profiles[profile.dir] = settings
        }
        return copy
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
