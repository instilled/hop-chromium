import AppKit
import OSLog
import ApplicationServices
import Carbon
import HopCore
import ServiceManagement
import UniformTypeIdentifiers

let log = Logger(subsystem: "instilled.hop", category: "app")

final class AppModel: ObservableObject {
    static let shared = AppModel()
    static let configURL = Config.defaultURL

    @Published private(set) var profiles: [ChromeProfile] = []
    @Published private(set) var config = Config()
    @Published private(set) var errors: [String] = []
    @Published private(set) var status: String?
    @Published private(set) var axTrusted = AXIsProcessTrusted()
    @Published private(set) var launchAtLogin = SMAppService.mainApp.status == .enabled

    /// Replaced when the config switches browsers.
    private var chrome = Chrome(browser: .chrome)

    /// Registered only while Chrome is frontmost, so they don't steal keys from other apps.
    private var chromeHotkeys: [UInt32] = []
    /// Registered only while a mini window has focus, so ⌘O stays "Open File…" everywhere else.
    private var promoteHotkey: UInt32?
    private var chromeBindings: [(hotkey: String, action: () -> Void)] = []
    private var chromeActive = false
    private var started = false

    /// Where links open: the profile last selected in Chrome, else Chrome's last_used, else config.miniProfile.
    var currentProfile: ChromeProfile {
        if let current = chrome.currentProfile(profiles: profiles) { return current }
        if let data = try? Data(contentsOf: chrome.browser.localStateURL), let dir = LocalState.lastUsed(from: data),
           let profile = Config.resolve(dir, in: profiles) {
            return profile
        }
        return Config.resolve(config.miniProfile, in: profiles)
            ?? ChromeProfile(dir: config.miniProfile, name: config.miniProfile, titleLabel: config.miniProfile)
    }

    func start() {
        guard !started else { return }
        started = true
        log.info("accessibility trusted: \(self.axTrusted, privacy: .public)")
        chrome.onFocusChange = { [weak self] in self?.updatePromoteHotkey() }
        reload()

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            self?.setChromeActive(app?.bundleIdentifier == self?.chrome.browser.bundleID)
        }
        setChromeActive(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == chrome.browser.bundleID)

        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name(kTISNotifySelectedKeyboardInputSourceChanged as String), object: nil, queue: .main
        ) { [weak self] _ in
            HotkeyCenter.shared.reloadKeyboardLayout()
            self?.registerHotkeys()
        }

        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            let trusted = AXIsProcessTrusted()
            if self?.axTrusted != trusted { self?.axTrusted = trusted }
        }
    }

    // MARK: Config

    func reload() {
        var problems: [String] = []
        // The browser comes from the config, so read that first (keeping the previous one if it's broken).
        if let data = try? Data(contentsOf: Self.configURL), let parsed = try? JSONDecoder().decode(Config.self, from: data) {
            if Browser.named(parsed.browser) == nil {
                problems.append("config.json: unknown browser \"\(parsed.browser)\" (use \(Browser.all.map(\.id).joined(separator: " or "))) — using Chrome")
            }
            switchBrowser(to: parsed.targetBrowser)
        }

        // macOS may block reading another app's data; then fall back to profiles recorded in the config.
        let discovered: [ChromeProfile]?
        do {
            discovered = try LocalState.profiles(from: Data(contentsOf: chrome.browser.localStateURL))
        } catch {
            log.info("Local State unreadable: \(error.localizedDescription, privacy: .public)")
            discovered = nil
        }

        let fm = FileManager.default
        if !fm.fileExists(atPath: Self.configURL.path) {
            do {
                try fm.createDirectory(at: Self.configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                let initial = Config.makeDefault(for: discovered ?? [])
                try (discovered.map(initial.syncing) ?? initial).encoded().write(to: Self.configURL)
            } catch {
                problems.append("Couldn't write \(Self.configURL.path): \(error.localizedDescription)")
            }
        }
        do {
            config = try JSONDecoder().decode(Config.self, from: Data(contentsOf: Self.configURL))
        } catch {
            problems.append("config.json: \(Self.describe(error)) — keeping previous config")
        }
        profiles = discovered ?? config.declaredProfiles()
        if discovered == nil, profiles.isEmpty {
            problems.append("Can't read \(chrome.browser.name)'s profiles. Run `hop --sync-profiles` in Terminal.")
        }

        for (key, settings) in config.profiles {
            guard let profile = Config.resolve(key, in: profiles) else {
                problems.append("config.json: no \(chrome.browser.name) profile \"\(key)\"")
                continue
            }
            if let label = settings.titleLabel, let i = profiles.firstIndex(of: profile) {
                profiles[i].titleLabel = label
            }
        }
        if !profiles.isEmpty, Config.resolve(config.miniProfile, in: profiles) == nil {
            problems.append("config.json: miniProfile (fallback) \"\(config.miniProfile)\" is not a \(chrome.browser.name) profile")
        }

        errors = problems
        registerHotkeys()
    }

    private func switchBrowser(to browser: Browser) {
        guard browser != chrome.browser else { return }
        log.info("browser: \(browser.name, privacy: .public)")
        let active = chromeActive
        if active { setChromeActive(false) }
        chrome = Chrome(browser: browser)
        chrome.onFocusChange = { [weak self] in self?.updatePromoteHotkey() }
        if started { setChromeActive(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == browser.bundleID) }
    }

    private func registerHotkeys() {
        HotkeyCenter.shared.unregister(chromeHotkeys + (promoteHotkey.map { [$0] } ?? []))
        chromeHotkeys = []
        promoteHotkey = nil
        if HotkeySpec.parse(config.promoteHotkey) == nil { addError("Invalid hotkey \"\(config.promoteHotkey)\"") }

        var bindings: [(String, () -> Void)] = []
        // Profile switching needs the profile in window titles; Vivaldi leaves it out (use its Workspaces instead).
        if chrome.browser.titlesShowProfile {
            if let hotkey = config.previousProfileHotkey { bindings.append((hotkey, { [weak self] in self?.cycleProfile(-1) })) }
            if let hotkey = config.nextProfileHotkey { bindings.append((hotkey, { [weak self] in self?.cycleProfile(1) })) }
            for profile in profiles {
                if let hotkey = profileSettings(profile)?.hotkey { bindings.append((hotkey, { [weak self] in self?.focus(profile) })) }
            }
        }
        chromeBindings = bindings.filter { hotkey, _ in
            if HotkeySpec.parse(hotkey) != nil { return true }
            addError("Invalid hotkey \"\(hotkey)\"")
            return false
        }
        if chromeActive { activateChromeHotkeys() }
        updatePromoteHotkey()
    }

    private func setChromeActive(_ active: Bool) {
        guard active != chromeActive else { return }
        chromeActive = active
        if active {
            chrome.observeFocus()
            activateChromeHotkeys()
        } else {
            HotkeyCenter.shared.unregister(chromeHotkeys)
            chromeHotkeys = []
        }
        updatePromoteHotkey()
    }

    private func updatePromoteHotkey() {
        let wanted = chromeActive && chrome.focusedWindowKind(profiles: profiles) == .app
        if wanted, promoteHotkey == nil {
            do { promoteHotkey = try HotkeyCenter.shared.register(config.promoteHotkey) { [weak self] in self?.promote() } }
            catch { addError(error.localizedDescription) }
        } else if !wanted, let id = promoteHotkey {
            HotkeyCenter.shared.unregister([id])
            promoteHotkey = nil
        }
    }

    private func activateChromeHotkeys() {
        HotkeyCenter.shared.unregister(chromeHotkeys)
        chromeHotkeys = chromeBindings.compactMap { hotkey, action in
            do { return try HotkeyCenter.shared.register(hotkey, action: action) }
            catch { addError(error.localizedDescription); return nil }
        }
    }

    private func profileSettings(_ profile: ChromeProfile) -> Config.ProfileSettings? {
        config.profiles.first { key, _ in Config.resolve(key, in: profiles)?.dir == profile.dir }?.value
    }

    // MARK: Actions

    func focus(_ profile: ChromeProfile) {
        chrome.focusOrLaunch(profile, profiles: profiles)
    }

    func cycleProfile(_ step: Int) {
        let order = config.cycleOrder(profiles)
        guard !order.isEmpty else { return }
        let current = chrome.frontmostProfile(profiles: profiles)
        let index = current.flatMap { c in order.firstIndex { $0.dir == c.dir } }
        let next = index.map { order[($0 + step + order.count) % order.count] } ?? order[0]
        focus(next)
    }

    func openLink(_ url: URL) {
        let profile = currentProfile
        log.info("\(self.config.openLinksIn.rawValue, privacy: .public) in \(profile.dir, privacy: .public): \(url.absoluteString, privacy: .public)")
        switch config.openLinksIn {
        case .mini: chrome.openApp(url, profileDir: profile.dir)
        case .tab: chrome.openTab(url, profileDir: profile.dir)
        }
    }

    var opensLinksInMini: Bool { config.openLinksIn == .mini }

    func setOpensLinksInMini(_ mini: Bool) {
        var updated = config
        updated.openLinksIn = mini ? .mini : .tab
        do {
            try updated.encoded().write(to: Self.configURL)
            config = updated
        } catch {
            flash("Couldn't save config: \(error.localizedDescription)")
        }
    }

    /// Links (as default browser), files, and hop://open?url=… from the CLI.
    func handle(url: URL) {
        log.info("open request: \(url.absoluteString, privacy: .public)")
        switch url.scheme?.lowercased() {
        case "hop":
            let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "url" }?.value.flatMap(URL.init(string:))
            if url.host == "reload" {
                reload()
            } else if let target {
                openLink(target)
            }
        case "http", "https", "file":
            openLink(url)
        default:
            break
        }
    }

    func promote() {
        chrome.promote(profiles: profiles, fallbackDir: currentProfile.dir) { [weak self] problem in
            guard let problem else { return }
            log.info("promote failed: \(problem, privacy: .public)")
            NSSound.beep()
            self?.flash(problem)
        }
    }

    // MARK: System

    func requestAccessibility() {
        axTrusted = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            flash("Launch at login: \(error.localizedDescription)")
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    func setDefaultBrowser() {
        let app = Bundle.main.bundleURL
        NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "http") { [weak self] error in
            if let error {
                DispatchQueue.main.async { self?.flash("Default browser: \(error.localizedDescription)") }
                return
            }
            NSWorkspace.shared.setDefaultApplication(at: app, toOpen: .html) { _ in }
        }
    }

    func openConfig() {
        if !NSWorkspace.shared.open(Self.configURL) {
            NSWorkspace.shared.open([Self.configURL], withApplicationAt: URL(fileURLWithPath: "/System/Applications/TextEdit.app"),
                                    configuration: NSWorkspace.OpenConfiguration())
        }
    }

    func profileHotkey(_ profile: ChromeProfile) -> String? {
        profileSettings(profile)?.hotkey
    }

    private func addError(_ message: String) {
        if !errors.contains(message) { errors.append(message) }
    }

    private func flash(_ message: String) {
        status = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            if self?.status == message { self?.status = nil }
        }
    }

    private static func describe(_ error: Error) -> String {
        switch error as? DecodingError {
        case .dataCorrupted(let c), .keyNotFound(_, let c), .typeMismatch(_, let c), .valueNotFound(_, let c):
            let path = c.codingPath.map(\.stringValue).joined(separator: ".")
            return path.isEmpty ? c.debugDescription : "\(path): \(c.debugDescription)"
        default:
            return error.localizedDescription
        }
    }
}
