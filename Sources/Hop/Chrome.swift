import AppKit
import ApplicationServices
import HopCore

extension AXUIElement {
    func value<T>(_ attribute: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(self, attribute as CFString, &value) == .success else { return nil }
        return value as? T
    }

    @discardableResult
    func set(_ attribute: String, _ value: CFTypeRef) -> Bool {
        AXUIElementSetAttributeValue(self, attribute as CFString, value) == .success
    }

    @discardableResult
    func perform(_ action: String) -> Bool {
        AXUIElementPerformAction(self, action as CFString) == .success
    }
}

/// Everything Hop does to the browser (Chrome, or another Chromium browser such as Vivaldi):
/// Accessibility for windows, `open -na` for launching.
final class Chrome {
    let browser: Browser

    private typealias Window = (element: AXUIElement, title: String)
    private var lastLaunch: [String: Date] = [:]
    private var observer: AXObserver?
    private var observedPID: pid_t = 0

    /// Called when Chrome's focused window changes (after `observeFocus()`).
    var onFocusChange: (() -> Void)?

    init(browser: Browser) {
        self.browser = browser
    }

    deinit {
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
    }

    private func classify(_ title: String, _ profiles: [ChromeProfile]) -> (kind: ChromeWindowKind, profile: ChromeProfile?) {
        WindowClassifier.classify(title, profiles: profiles, marker: browser.titleMarker)
    }

    private var runningApp: NSRunningApplication? {
        // `open -na` briefly spawns a second Chrome process that hands off to the first; prefer the oldest.
        NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleID)
            .filter { !$0.isTerminated }
            .min { ($0.launchDate ?? .distantFuture) < ($1.launchDate ?? .distantFuture) }
    }

    private func axApp() -> AXUIElement? {
        runningApp.map { AXUIElementCreateApplication($0.processIdentifier) }
    }

    /// Front-to-back. Only windows on the current Space are visible to Accessibility.
    private func windows(_ app: AXUIElement) -> [Window] {
        let elements: [AXUIElement] = app.value(kAXWindowsAttribute) ?? []
        return elements.map { ($0, $0.value(kAXTitleAttribute) ?? "") }
    }

    private func normalWindows(of profile: ChromeProfile, in app: AXUIElement, profiles: [ChromeProfile]) -> [Window] {
        windows(app).filter {
            let match = classify($0.title, profiles)
            return match.kind == .normal && match.profile?.dir == profile.dir
        }
    }

    /// Profile of Chrome's focused window, if Chrome is frontmost.
    func frontmostProfile(profiles: [ChromeProfile]) -> ChromeProfile? {
        guard runningApp?.isActive == true, let app = axApp(),
              let focused: AXUIElement = app.value(kAXFocusedWindowAttribute) else { return nil }
        return classify(focused.value(kAXTitleAttribute) ?? "", profiles).profile
    }

    /// Start watching Chrome's window focus. Cheap to call repeatedly; re-attaches if Chrome was relaunched.
    func observeFocus() {
        guard let pid = runningApp?.processIdentifier, pid != observedPID else { return }
        if let old = observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(old), .commonModes)
        }
        observer = nil
        var created: AXObserver?
        let callback: AXObserverCallback = { _, _, _, refcon in
            guard let refcon else { return }
            Unmanaged<Chrome>.fromOpaque(refcon).takeUnretainedValue().onFocusChange?()
        }
        guard AXObserverCreate(pid, callback, &created) == .success, let created else { return }
        let app = AXUIElementCreateApplication(pid)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for notification in [kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification] {
            AXObserverAddNotification(created, app, notification as CFString, refcon)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .commonModes)
        observer = created
        observedPID = pid
    }

    func focusedWindowKind(profiles: [ChromeProfile]) -> ChromeWindowKind? {
        guard let app = axApp(), let window: AXUIElement = app.value(kAXFocusedWindowAttribute) else { return nil }
        return classify(window.value(kAXTitleAttribute) ?? "", profiles).kind
    }

    /// Profile of Chrome's frontmost normal window, whether or not Chrome is active: the profile last selected.
    /// Mini (app) windows are skipped so they don't make their own profile sticky.
    func currentProfile(profiles: [ChromeProfile]) -> ChromeProfile? {
        guard let app = axApp() else { return nil }
        let focused: AXUIElement? = app.value(kAXFocusedWindowAttribute)
        let candidates = (focused.map { [$0] } ?? []) + windows(app).map(\.element)
        let titles = candidates.map { ($0.value(kAXTitleAttribute) as String?) ?? "<nil>" }
        log.debug("current-profile candidates: \(titles, privacy: .public)")
        return candidates.lazy
            .map { self.classify($0.value(kAXTitleAttribute) ?? "", profiles) }
            .first { $0.kind == .normal && $0.profile != nil }?
            .profile
    }

    /// Raise the profile's window (cycling through several if it already has focus), or open one.
    func focusOrLaunch(_ profile: ChromeProfile, profiles: [ChromeProfile]) {
        if let app = axApp() {
            let matches = normalWindows(of: profile, in: app, profiles: profiles)
            if !matches.isEmpty {
                var target = matches[0].element
                if runningApp?.isActive == true, matches.count > 1,
                   let focused: AXUIElement = app.value(kAXFocusedWindowAttribute),
                   let i = matches.firstIndex(where: { CFEqual($0.element, focused) }) {
                    target = matches[(i + 1) % matches.count].element
                }
                raise(target, in: app)
                return
            }
        }
        // A new window takes a moment to appear; don't open a second one on a repeated keypress.
        if let last = lastLaunch[profile.dir], Date().timeIntervalSince(last) < 3 { return }
        lastLaunch[profile.dir] = Date()
        launch(profileDir: profile.dir)
    }

    func openApp(_ url: URL, profileDir: String) {
        launch(profileDir: profileDir, "--app=\(url.absoluteString)")
    }

    func openTab(_ url: URL, profileDir: String) {
        launch(profileDir: profileDir, url.absoluteString)
    }

    /// Move the frontmost app-mode window's page into a normal tab of the same profile, then close it.
    func promote(profiles: [ChromeProfile], fallbackDir: String, completion: @escaping (String?) -> Void) {
        guard let app = axApp() else { return completion("\(browser.name) isn't running") }
        guard let window: AXUIElement = app.value(kAXFocusedWindowAttribute) ?? windows(app).first?.element else {
            return completion("No \(browser.name) window")
        }
        let match = classify(window.value(kAXTitleAttribute) ?? "", profiles)
        guard match.kind == .app else { return completion("Not a mini window") }

        // Chrome only builds its web accessibility tree on request.
        app.set("AXManualAccessibility", kCFBooleanTrue)
        pollURL(window, attempts: 20) { [weak self] url in
            app.set("AXManualAccessibility", kCFBooleanFalse)
            guard let self else { return }
            guard let url else { return completion("Couldn't read URL") }
            let profileDir = match.profile?.dir ?? fallbackDir
            // The browser puts the tab in its last active normal window, and with the mini window focused it may
            // open a new window instead. So raise the profile's normal window first (any one if titles don't say).
            let target = self.windows(app).first {
                let m = self.classify($0.title, profiles)
                return m.kind == .normal && (m.profile == nil || m.profile?.dir == profileDir)
            }
            if let target { self.raise(target.element, in: app) }
            DispatchQueue.main.asyncAfter(deadline: .now() + (target == nil ? 0 : 0.15)) {
                self.launch(profileDir: profileDir, url.absoluteString)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    if let close: AXUIElement = window.value(kAXCloseButtonAttribute) { close.perform(kAXPressAction) }
                }
            }
            completion(nil)
        }
    }

    private func pollURL(_ window: AXUIElement, attempts: Int, done: @escaping (URL?) -> Void) {
        if let url = webAreaURL(window) { return done(url) }
        guard attempts > 0 else { return done(nil) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.pollURL(window, attempts: attempts - 1, done: done)
        }
    }

    /// Breadth-first so the top-level page wins over iframes.
    private func webAreaURL(_ root: AXUIElement) -> URL? {
        var queue = [root]
        var visited = 0
        while !queue.isEmpty, visited < 3000 {
            let element = queue.removeFirst()
            visited += 1
            if (element.value(kAXRoleAttribute) as String?) == "AXWebArea", let url: URL = element.value("AXURL") {
                return url
            }
            queue.append(contentsOf: (element.value(kAXChildrenAttribute) as [AXUIElement]?) ?? [])
        }
        return nil
    }

    private func raise(_ window: AXUIElement, in app: AXUIElement) {
        window.set(kAXMinimizedAttribute, kCFBooleanFalse)
        app.set(kAXFrontmostAttribute, kCFBooleanTrue)
        window.perform(kAXRaiseAction)
        window.set(kAXMainAttribute, kCFBooleanTrue)
    }

    private func launch(profileDir: String, _ extra: String...) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-na", browser.name, "--args", "--profile-directory=\(profileDir)"] + extra
        do { try process.run() } catch { log.error("launch failed: \(error.localizedDescription, privacy: .public)") }
    }
}
