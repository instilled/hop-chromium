import HopCore
import Foundation

// hop <url | file | search terms> — opens it in a Hop mini window.

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty || args.first == "-h" || args.first == "--help" {
    print("usage: hop <url | file | search terms>")
    exit(args.isEmpty ? 64 : 0)
}

let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
guard let target = InputResolver.resolve(args.joined(separator: " "), cwd: cwd) else {
    FileHandle.standardError.write(Data("hop: nothing to open\n".utf8))
    exit(65)
}

var allowed = CharacterSet.alphanumerics
allowed.insert(charactersIn: "-._~")
let encoded = target.absoluteString.addingPercentEncoding(withAllowedCharacters: allowed) ?? target.absoluteString

// Installed as Hop.app/Contents/Helpers/hop; target the bundle we live in.
let executable = (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])).resolvingSymlinksInPath()
let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

let open = Process()
open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
open.arguments = (bundle.pathExtension == "app" ? ["-g", "-a", bundle.path] : ["-g", "-b", "com.instilled.hop"])
    + ["hop://open?url=\(encoded)"]
do {
    try open.run()
    open.waitUntilExit()
    exit(open.terminationStatus)
} catch {
    FileHandle.standardError.write(Data("hop: \(error.localizedDescription)\n".utf8))
    exit(1)
}
