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

    /// Where links (default browser, `hop <url>`) open.
    public enum LinkTarget: String, Codable, Sendable {
        /// A mini (--app) window, Little Arc style.
        case mini
        /// A normal tab in the current profile.
        case tab
    }

    public static let defaultURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/hop/config.json")

    /// Arc's "Open in Arc" from Little Arc. Active only while a mini window has focus.
    public static let defaultPromoteHotkey = "cmd+o"
    public static let defaultPreviousProfileHotkey = "cmd+opt+left"
    public static let defaultNextProfileHotkey = "cmd+opt+right"

    /// Which browser Hop drives: a `Browser.id` ("chrome", "vivaldi").
    public var browser: String
    /// Mini windows open in the current profile; this is only the fallback when none can be determined.
    public var miniProfile: String
    public var promoteHotkey: String
    /// Arc-style profile cycling, active only while Chrome is frontmost.
    public var previousProfileHotkey: String?
    public var nextProfileHotkey: String?
    /// Cycle order; profiles not listed are skipped. Defaults to all profiles ("Default" first).
    public var profileOrder: [String]?
    public var openLinksIn: LinkTarget
    public var profiles: [String: ProfileSettings]

    public init(browser: String = Browser.chrome.id,
                miniProfile: String = "Default",
                promoteHotkey: String = defaultPromoteHotkey,
                previousProfileHotkey: String? = defaultPreviousProfileHotkey,
                nextProfileHotkey: String? = defaultNextProfileHotkey,
                profileOrder: [String]? = nil,
                openLinksIn: LinkTarget = .mini,
                profiles: [String: ProfileSettings] = [:]) {
        self.browser = browser
        self.miniProfile = miniProfile
        self.promoteHotkey = promoteHotkey
        self.previousProfileHotkey = previousProfileHotkey
        self.nextProfileHotkey = nextProfileHotkey
        self.profileOrder = profileOrder
        self.openLinksIn = openLinksIn
        self.profiles = profiles
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        browser = try c.decodeIfPresent(String.self, forKey: .browser) ?? Browser.chrome.id
        miniProfile = try c.decodeIfPresent(String.self, forKey: .miniProfile) ?? "Default"
        promoteHotkey = try c.decodeIfPresent(String.self, forKey: .promoteHotkey) ?? Self.defaultPromoteHotkey
        // A missing key means default; an explicit null disables the hotkey.
        previousProfileHotkey = c.contains(.previousProfileHotkey)
            ? try c.decodeIfPresent(String.self, forKey: .previousProfileHotkey) : Self.defaultPreviousProfileHotkey
        nextProfileHotkey = c.contains(.nextProfileHotkey)
            ? try c.decodeIfPresent(String.self, forKey: .nextProfileHotkey) : Self.defaultNextProfileHotkey
        profileOrder = try c.decodeIfPresent([String].self, forKey: .profileOrder)
        openLinksIn = try c.decodeIfPresent(LinkTarget.self, forKey: .openLinksIn) ?? .mini
        profiles = try c.decodeIfPresent([String: ProfileSettings].self, forKey: .profiles) ?? [:]
    }

    /// The configured browser; unknown ids fall back to Chrome (reported by the app).
    public var targetBrowser: Browser { Browser.named(browser) ?? .chrome }

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
    /// Recorded profiles that no longer exist (e.g. after switching browsers) are dropped unless they have a hotkey.
    public func syncing(_ discovered: [ChromeProfile]) -> Config {
        var copy = self
        copy.profiles = profiles.filter { key, settings in
            settings.hotkey != nil || discovered.contains { Self.resolve(key, in: [$0]) != nil }
        }
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
