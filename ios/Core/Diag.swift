import Foundation
import UIKit

/// Test mode and diagnostics. Nothing leaves the phone unless Max copies it.
enum Env {
    static var values: [String: String] { ProcessInfo.processInfo.environment }
    /// UI tests: pool from a plain JSON file, fresh state directory, no network
    static var testPoolFile: String? { values["CORE_POOL_FILE"] }
    static var isTest: Bool { testPoolFile != nil }
    static var testUnlocked: Bool { values["CORE_TEST_UNLOCKED"] == "1" }
    static var testReview: Bool { values["CORE_TEST_REVIEW"] == "1" }
    static var stateDir: URL {
        if let d = values["CORE_STATE_DIR"] { return URL(fileURLWithPath: d, isDirectory: true) }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }
}

enum Diag {
    private static let maxBytes = 48_000
    private static var file: URL { Env.stateDir.appendingPathComponent("diag.log") }
    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func log(_ message: String) {
        let line = "\(stamp.string(from: Date()))  \(message)\n"
        #if DEBUG
        print("core:", message)
        #endif
        let fm = FileManager.default
        try? fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile()
            h.write(Data(line.utf8))
            try? h.close()
        } else {
            try? Data(line.utf8).write(to: file)
        }
        trim()
    }

    private static func trim() {
        guard let data = try? Data(contentsOf: file), data.count > maxBytes else { return }
        let tail = data.suffix(maxBytes / 2)
        if let nl = tail.firstIndex(of: 10) { try? tail[(nl + 1)...].write(to: file) }
    }

    static func installCrashHandler() {
        NSSetUncaughtExceptionHandler { e in
            Diag.log("CRASH \(e.name.rawValue): \(e.reason ?? "") \(e.callStackSymbols.prefix(8).joined(separator: " | "))")
        }
    }

    // MARK: Build info

    static var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? "?"
        let b = info["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    /// Short git commit, written by install.sh and CI. "dev" when built from Xcode by hand.
    static var commit: String { Bundle.main.infoDictionary?["CoreCommit"] as? String ?? "dev" }

    static var installedAt: Date? {
        (try? Bundle.main.bundleURL.resourceValues(forKeys: [.creationDateKey]))?.creationDate
    }

    /// Expiry of the signing profile. Free accounts get 7 days.
    static var expiresAt: Date? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url) else { return nil }
        let text = String(decoding: data, as: UTF8.self)
        guard let r = text.range(of: #"<key>ExpirationDate</key>\s*<date>([^<]+)</date>"#, options: .regularExpression) else { return nil }
        let inner = text[r]
        guard let open = inner.range(of: "<date>"), let close = inner.range(of: "</date>") else { return nil }
        return ISO8601DateFormatter().date(from: String(inner[open.upperBound..<close.lowerBound]))
    }

    static func text(poolCount: Int, poolUpdated: String?, state: AppState) -> String {
        let d = UIDevice.current
        var out = """
        Core \(version) commit \(commit)
        iOS \(d.systemVersion), \(d.model)
        installed \(installedAt.map { stamp.string(from: $0) } ?? "?"), profile until \(expiresAt.map { stamp.string(from: $0) } ?? "?")
        pool \(poolCount) moments, updated \(poolUpdated ?? "?")
        seen \(state.seen.count), saved \(state.saved.count), muted \(state.muted.count), log \(state.log.count)
        feed time today \(Int(state.feedTime[Day.key()] ?? 0)) s
        \(Latency.line("swipe preloaded", Latency.stats(state.playLatency ?? [], buffered: true)))
        \(Latency.line("swipe not preloaded", Latency.stats(state.playLatency ?? [], buffered: false)))

        """
        out += (try? String(contentsOf: file, encoding: .utf8)) ?? "(no log)"
        return out
    }
}
