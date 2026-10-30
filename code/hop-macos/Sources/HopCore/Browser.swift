import Foundation

/// A Chromium browser Hop can drive. All of them take `--profile-directory` and `--app`, keep a Chrome-format
/// `Local State`, and title normal windows "<page> - <marker>[ - <profile label>]".
public struct Browser: Equatable, Sendable {
    /// Config value, e.g. "chrome".
    public let id: String
    /// App name for `open -a` and messages.
    public let name: String
    public let bundleID: String
    /// What normal (non-app) window titles carry after the page title.
    public let titleMarker: String
    /// User-data directory under ~/Library/Application Support.
    public let supportDir: String
    /// Whether normal window titles end in the profile label. Without it Hop can't tell profiles apart,
    /// so profile switching is off (Vivaldi has Workspaces for that).
    public let titlesShowProfile: Bool

    public static let chrome = Browser(id: "chrome", name: "Google Chrome", bundleID: "com.google.Chrome",
                                       titleMarker: "Google Chrome", supportDir: "Google/Chrome", titlesShowProfile: true)
    public static let vivaldi = Browser(id: "vivaldi", name: "Vivaldi", bundleID: "com.vivaldi.Vivaldi",
                                        titleMarker: "Vivaldi", supportDir: "Vivaldi", titlesShowProfile: false)
    public static let all = [chrome, vivaldi]

    public static func named(_ id: String) -> Browser? {
        all.first { $0.id.caseInsensitiveCompare(id) == .orderedSame }
    }

    public var localStateURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/\(supportDir)/Local State")
    }
}
