import Foundation

public struct ChromeProfile: Equatable, Identifiable, Sendable {
    /// Directory under the Chrome user-data dir, e.g. "Default" or "Profile 5".
    public let dir: String
    /// Local profile name, e.g. "Work".
    public let name: String
    /// What Chrome appends to window titles, e.g. "Alex (Work)".
    public var titleLabel: String
    public var id: String { dir }

    public init(dir: String, name: String, titleLabel: String) {
        self.dir = dir
        self.name = name
        self.titleLabel = titleLabel
    }
}

public enum LocalStateError: Error, CustomStringConvertible {
    case missingInfoCache
    public var description: String { "profile.info_cache not found in Local State" }
}

public enum LocalState {
    public static let defaultURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Google/Chrome/Local State")

    public static func profiles(from data: Data) throws -> [ChromeProfile] {
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let cache = (root?["profile"] as? [String: Any])?["info_cache"] as? [String: [String: Any]] else {
            throw LocalStateError.missingInfoCache
        }
        return cache.map { dir, info in
            let name = info["name"] as? String ?? dir
            let given = (info["gaia_given_name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let isDefaultName = info["is_using_default_name"] as? Bool ?? false
            return ChromeProfile(dir: dir, name: name,
                                 titleLabel: titleLabel(name: name, gaiaGivenName: given, isUsingDefaultName: isDefaultName))
        }
        .sorted(by: profileOrder)
    }

    /// The profile Chrome last made active (`profile.last_used`). Chrome writes Local State lazily, so this can lag.
    public static func lastUsed(from data: Data) -> String? {
        let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (root?["profile"] as? [String: Any])?["last_used"] as? String
    }

    /// Mirrors how Chrome builds the profile part of a window title:
    /// signed in with a custom name → "Given (Name)"; default name → "Given"; signed out → "Name".
    public static func titleLabel(name: String, gaiaGivenName: String?, isUsingDefaultName: Bool) -> String {
        guard let given = gaiaGivenName else { return name }
        if isUsingDefaultName || given == name { return given }
        return "\(given) (\(name))"
    }

    /// "Default" first, then "Profile 1", "Profile 2", … in numeric order.
    static func profileOrder(_ lhs: ChromeProfile, _ rhs: ChromeProfile) -> Bool {
        if lhs.dir == "Default" { return rhs.dir != "Default" }
        if rhs.dir == "Default" { return false }
        return lhs.dir.localizedStandardCompare(rhs.dir) == .orderedAscending
    }
}

public enum ChromeWindowKind: Equatable, Sendable {
    /// A regular browser window: "<page> - Google Chrome - <label>".
    case normal
    /// An --app window: "<page> - <label>".
    case app
}

public enum WindowClassifier {
    static let marker = "Google Chrome"

    public static func classify(_ title: String, profiles: [ChromeProfile]) -> (kind: ChromeWindowKind, profile: ChromeProfile?) {
        // Longest label first so "Alex (Work)" wins over a profile labelled "Work".
        let byLabel = profiles.sorted { $0.titleLabel.count > $1.titleLabel.count }
        for p in byLabel {
            let suffix = "\(marker) - \(p.titleLabel)"
            if title == suffix || title.hasSuffix(" - " + suffix) { return (.normal, p) }
        }
        for p in byLabel where title == p.titleLabel || title.hasSuffix(" - " + p.titleLabel) {
            return (.app, p)
        }
        // Chrome drops the profile label when only one profile exists.
        if title == marker || title.hasSuffix(" - " + marker) {
            return (.normal, profiles.count == 1 ? profiles.first : nil)
        }
        return (.app, nil)
    }
}
