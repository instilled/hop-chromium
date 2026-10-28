import Foundation

/// Turns what the user typed (mini window or CLI) into a URL: explicit URL, file path, bare host, or Google search.
public enum InputResolver {
    static let schemes = ["http://", "https://", "file://", "chrome://", "chrome-extension://", "about:", "data:", "view-source:"]
    static let hostPattern = #"^(localhost|\d{1,3}(\.\d{1,3}){3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?([/?#].*)?$"#
    static let plainHTTPPattern = #"^(localhost|\d{1,3}(\.\d{1,3}){3})([:/?#]|$)"#

    public static func resolve(_ raw: String, cwd: URL? = nil,
                               fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }) -> URL? {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return nil }
        let lower = input.lowercased()

        if schemes.contains(where: lower.hasPrefix) { return URL(string: input) }
        if ["/", "~", "./", "../"].contains(where: input.hasPrefix) { return fileURL(input, cwd: cwd) }
        if let cwd, fileExists(cwd.appendingPathComponent(input).path) { return fileURL(input, cwd: cwd) }

        if !input.contains(where: \.isWhitespace),
           input.range(of: hostPattern, options: [.regularExpression, .caseInsensitive]) != nil {
            let plain = lower.range(of: plainHTTPPattern, options: .regularExpression) != nil
            return URL(string: (plain ? "http://" : "https://") + input)
        }
        return searchURL(input)
    }

    static func fileURL(_ path: String, cwd: URL?) -> URL {
        let expanded = (path as NSString).expandingTildeInPath
        if expanded.hasPrefix("/") { return URL(fileURLWithPath: expanded).standardizedFileURL }
        let base = cwd ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        return base.appendingPathComponent(expanded).standardizedFileURL
    }

    static func searchURL(_ query: String) -> URL? {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?#")
        guard let q = query.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: "https://www.google.com/search?q=\(q)")
    }
}
