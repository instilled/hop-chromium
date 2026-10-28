import Foundation
import Testing
@testable import HopCore

let work = ChromeProfile(dir: "Default", name: "Work", titleLabel: "Alex (Work)")
let personal = ChromeProfile(dir: "Profile 5", name: "Personal", titleLabel: "Alex (Personal)")

@Test func parsesLocalState() throws {
    let json = """
    {"profile":{"info_cache":{
      "Profile 5":{"name":"Personal","gaia_given_name":"Alex","is_using_default_name":false},
      "Default":{"name":"Work","gaia_given_name":"Alex","is_using_default_name":false},
      "Profile 12":{"name":"Person 3","gaia_given_name":"","is_using_default_name":true}
    }}}
    """
    let profiles = try LocalState.profiles(from: Data(json.utf8))
    #expect(profiles.map(\.dir) == ["Default", "Profile 5", "Profile 12"])
    #expect(profiles.map(\.titleLabel) == ["Alex (Work)", "Alex (Personal)", "Person 3"])
}

@Test func readsLastUsedProfile() {
    #expect(LocalState.lastUsed(from: Data(#"{"profile":{"last_used":"Profile 5"}}"#.utf8)) == "Profile 5")
    #expect(LocalState.lastUsed(from: Data("{}".utf8)) == nil)
}

@Test func titleLabelRules() {
    #expect(LocalState.titleLabel(name: "Work", gaiaGivenName: "Alex", isUsingDefaultName: false) == "Alex (Work)")
    #expect(LocalState.titleLabel(name: "Person 1", gaiaGivenName: "Alex", isUsingDefaultName: true) == "Alex")
    #expect(LocalState.titleLabel(name: "Alex", gaiaGivenName: "Alex", isUsingDefaultName: false) == "Alex")
    #expect(LocalState.titleLabel(name: "Work", gaiaGivenName: nil, isUsingDefaultName: false) == "Work")
}

@Test func classifiesWindowTitles() {
    let profiles = [work, personal]
    #expect(WindowClassifier.classify("New Tab - Google Chrome - Alex (Work)", profiles: profiles) == (.normal, work))
    #expect(WindowClassifier.classify("What's New - Google Chrome - Alex (Personal)", profiles: profiles) == (.normal, personal))
    #expect(WindowClassifier.classify("Example Domain - Alex (Work)", profiles: profiles) == (.app, work))
    // A page title mentioning the other profile does not confuse matching.
    #expect(WindowClassifier.classify("Alex (Personal) notes - Google Chrome - Alex (Work)", profiles: profiles) == (.normal, work))
    #expect(WindowClassifier.classify("Something else", profiles: profiles) == (.app, nil))
    #expect(WindowClassifier.classify("New Tab - Google Chrome", profiles: [work]) == (.normal, work))
}

@Test func longestLabelWins() {
    let short = ChromeProfile(dir: "Profile 2", name: "Work", titleLabel: "Work")
    #expect(WindowClassifier.classify("X - Google Chrome - Alex (Work)", profiles: [short, work]) == (.normal, work))
}

@Test func parsesHotkeys() {
    #expect(HotkeySpec.parse("opt+space") == HotkeySpec(key: "space", option: true))
    #expect(HotkeySpec.parse("cmd+opt+right") == HotkeySpec(key: "right", command: true, option: true))
    #expect(HotkeySpec.parse("Opt+Shift+P") == HotkeySpec(key: "p", option: true, shift: true))
    #expect(HotkeySpec.parse("hyper+p") == nil)
    #expect(HotkeySpec.parse("opt+pageup") == nil)
    #expect(HotkeySpec.parse("cmd+opt+left")?.description == "⌥⌘←")
    #expect(HotkeySpec.parse("opt+shift+p")?.description == "⌥⇧P")
}

@Test func resolvesInput() {
    let none: (String) -> Bool = { _ in false }
    #expect(InputResolver.resolve("example.com", fileExists: none)?.absoluteString == "https://example.com")
    #expect(InputResolver.resolve("https://x.com/a?b=1", fileExists: none)?.absoluteString == "https://x.com/a?b=1")
    #expect(InputResolver.resolve("localhost:3000/app", fileExists: none)?.absoluteString == "http://localhost:3000/app")
    #expect(InputResolver.resolve("1password.com", fileExists: none)?.absoluteString == "https://1password.com")
    #expect(InputResolver.resolve("192.168.1.1", fileExists: none)?.absoluteString == "http://192.168.1.1")
    #expect(InputResolver.resolve("swift concurrency & actors", fileExists: none)?.absoluteString
        == "https://www.google.com/search?q=swift%20concurrency%20%26%20actors")
    #expect(InputResolver.resolve("   ", fileExists: none) == nil)
    #expect(InputResolver.resolve("/tmp/a.html", fileExists: none)?.absoluteString == "file:///tmp/a.html")
    let cwd = URL(fileURLWithPath: "/Users/me/site")
    #expect(InputResolver.resolve("index.html", cwd: cwd, fileExists: { $0 == "/Users/me/site/index.html" })?
        .absoluteString == "file:///Users/me/site/index.html")
}

@Test func configDefaultsAndNulls() throws {
    let empty = try JSONDecoder().decode(Config.self, from: Data("{}".utf8))
    #expect(empty == Config())
    let disabled = try JSONDecoder().decode(Config.self, from: Data(#"{"nextProfileHotkey": null}"#.utf8))
    #expect(disabled.nextProfileHotkey == nil)
    #expect(disabled.previousProfileHotkey == Config.defaultPreviousProfileHotkey)
}

@Test func syncKeepsHotkeysAndOverrides() {
    let config = Config(profiles: ["Personal": .init(hotkey: "ctrl+2"), "Default": .init(titleLabel: "Custom")])
    let synced = config.syncing([work, personal])
    #expect(synced.profiles == [
        "Default": .init(titleLabel: "Custom", name: "Work"),
        "Profile 5": .init(hotkey: "ctrl+2", titleLabel: "Alex (Personal)", name: "Personal"),
    ])
    #expect(synced.declaredProfiles() == [
        ChromeProfile(dir: "Default", name: "Work", titleLabel: "Custom"), personal,
    ])
}

@Test func cycleOrderResolvesNamesAndDirs() {
    let config = Config(profileOrder: ["Personal", "Default", "Nope"])
    #expect(config.cycleOrder([work, personal]) == [personal, work])
    #expect(Config().cycleOrder([work, personal]) == [work, personal])
}
