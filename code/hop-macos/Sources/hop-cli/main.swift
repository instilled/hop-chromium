import Foundation
import HopCore

// hop <url | file | search terms>   open it in a Hop mini window
// hop --sync-profiles               record the browser's profiles in Hop's config

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("hop: \(message)\n".utf8))
    exit(code)
}

/// Hands a hop:// URL to the Hop.app this binary lives in (Hop.app/Contents/Helpers/hop).
func sendToApp(_ url: String) -> Int32 {
    let executable = (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])).resolvingSymlinksInPath()
    let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let open = Process()
    open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    open.arguments = (bundle.pathExtension == "app" ? ["-g", "-a", bundle.path] : ["-g", "-b", "instilled.hop"]) + [url]
    do {
        try open.run()
        open.waitUntilExit()
        return open.terminationStatus
    } catch {
        fail(error.localizedDescription)
    }
}

/// Hop.app may be denied access to the browser's Local State; a Terminal-launched process usually isn't.
func syncProfiles() -> Never {
    let url = Config.defaultURL
    let config = (try? Data(contentsOf: url)).map { data in
        do { return try JSONDecoder().decode(Config.self, from: data) } catch { fail("\(url.path) is invalid: \(error)") }
    }
    let localState = (config?.targetBrowser ?? .chrome).localStateURL
    let discovered: [ChromeProfile]
    do {
        discovered = try LocalState.profiles(from: Data(contentsOf: localState))
    } catch {
        fail("can't read \(localState.path): \(error.localizedDescription)")
    }
    let existing = config ?? Config.makeDefault(for: discovered)
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try existing.syncing(discovered).encoded().write(to: url)
    } catch {
        fail("can't write \(url.path): \(error.localizedDescription)")
    }
    for profile in discovered { print("\(profile.dir): \(profile.name) — titles end in \"\(profile.titleLabel)\"") }
    print("Wrote \(url.path)")
    exit(sendToApp("hop://reload"))
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case nil, "-h", "--help":
    print("usage: hop <url | file | search terms>\n       hop --sync-profiles")
    exit(args.isEmpty ? 64 : 0)
case "--sync-profiles":
    syncProfiles()
default:
    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    guard let target = InputResolver.resolve(args.joined(separator: " "), cwd: cwd) else { fail("nothing to open", code: 65) }
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    let encoded = target.absoluteString.addingPercentEncoding(withAllowedCharacters: allowed) ?? target.absoluteString
    exit(sendToApp("hop://open?url=\(encoded)"))
}
