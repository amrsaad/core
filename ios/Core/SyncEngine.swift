import Foundation
#if canImport(Combine)
import Combine
#else
// Linux-Ersatz, nur damit der Ablauf dort getestet werden kann
protocol ObservableObject: AnyObject {}
@propertyWrapper struct Published<Value> {
    var wrappedValue: Value
    init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
}
#endif

// Geräte-Sync (Auftrag Max 28.10.2026), Teil 2: der Ablauf. Nur Foundation, Netz und Krypto kommen als Protokolle herein,
// darum läuft der Ablauf auch unter Linux gegen eine nachgebaute API. Gleiche Regeln wie src/lib/sync/controller.ts:
// - Beim Start laden und zusammenführen, danach höchstens ein Schreiben.
// - 10 s nach der letzten Änderung schreiben. Beim Verlassen der App sofort, beim Zurückkommen laden.
// - Weicht die Version auf GitHub ab (409 oder 422), erst laden, zusammenführen, dann schreiben (bis zu vier Anläufe).
// - Ohne Netz sammelt die App weiter, der nächste erfolgreiche Lauf holt alles nach.
// - Eine Datei, die nicht entschlüsselt werden kann, wird nie überschrieben.

struct SyncError: Error, Equatable {
    enum Kind: Equatable { case auth, forbidden, notfound, conflict, rate, offline, server, format, key, setup }
    var kind: Kind
    var message: String
    var status: Int?

    /// Lohnt sich ein späterer Versuch ohne Zutun des Nutzers?
    var retry: Bool { kind == .offline || kind == .server || kind == .rate }

    /// Fehlertext in einer Zeile, ohne Token oder Antwortinhalt (gleiche Texte wie die Web-App)
    static func failure(status: Int, rateLimited: Bool = false) -> SyncError {
        switch status {
        case 401: return SyncError(kind: .auth, message: "GitHub rejected the token (401). Paste a new one.", status: status)
        case 403 where rateLimited: return SyncError(kind: .rate, message: "GitHub rate limit reached (403). Will retry.", status: status)
        case 429: return SyncError(kind: .rate, message: "GitHub rate limit reached (429). Will retry.", status: status)
        case 403: return SyncError(kind: .forbidden, message: "The token cannot write to core-content (403). Check its repository and Contents permission.", status: status)
        case 404: return SyncError(kind: .notfound, message: "core-content not found for this token (404). Check the token’s repository access.", status: status)
        case 409, 422: return SyncError(kind: .conflict, message: "The sync file changed (\(status)).", status: status)
        default: return SyncError(kind: .server, message: "GitHub is not available (\(status)). Will retry.", status: status)
        }
    }

    static let offline = SyncError(kind: .offline, message: "No connection to GitHub. Will retry.", status: nil)
    static let unexpected = SyncError(kind: .format, message: "GitHub sent an unexpected answer.", status: nil)
}

struct SyncRemote: Equatable {
    var text: String
    var sha: String
}

/// Die eine Datei auf GitHub. Fehler sind immer SyncError.
protocol SyncTransport {
    /// nil, wenn die Datei noch nicht existiert
    func read(token: String) async throws -> SyncRemote?
    /// Core Digest: state/digest-latest.enc, nur lesen. nil, wenn es die Datei nicht gibt (Standard).
    func readDigest(token: String) async throws -> SyncRemote?
    /// Gibt die neue sha zurück
    func write(token: String, text: String, sha: String?, message: String) async throws -> String
}

/// Verschlüsselung des Dokuments mit dem Pool-Schlüssel. Fehler sind SyncError (.key oder .format).
protocol SyncCipher {
    func encrypt(_ doc: J) throws -> String
    func decrypt(_ text: String) throws -> J
    /// Core Digest: Inhalt von state/digest-latest.enc
    func decryptLatest(_ text: String) throws -> DigestLatest
}

extension SyncTransport {
    func readDigest(token: String) async throws -> SyncRemote? { nil }
}

extension SyncCipher {
    func decryptLatest(_ text: String) throws -> DigestLatest {
        throw SyncError(kind: .format, message: "The digest file has an unexpected format.", status: nil)
    }
}

struct SyncStatus: Equatable {
    var hasToken = false
    /// letzter erfolgreicher Kontakt mit GitHub
    var lastSync: Date?
    /// eine Zeile, nil wenn alles gut
    var error: String?
    var running = false
}

@MainActor
final class SyncEngine: ObservableObject {
    nonisolated static let writeDelay: TimeInterval = 10
    nonisolated static let maxAttempts = 4
    /// Wartezeit nach einem Fehler, der sich von selbst erledigen kann: 30 s, 1 min, 2 min, dann alle 5 min
    nonisolated static func retryDelay(fails: Int) -> TimeInterval { min(300, 30 * pow(2, Double(max(0, fails - 1)))) }

    struct Deps {
        var transport: SyncTransport
        var cipher: () -> SyncCipher?
        var token: () -> String?
        /// Normalisiertes Dokument des lokalen Zustands
        var local: () -> J?
        /// Dokument von GitHub in den Zustand übernehmen, ohne neue Zeitstempel. Rechnet gegen den neuesten Zustand.
        var adopt: (J) -> Void
        /// Core Digest: neue Wochenkarte übernehmen
        var adoptDigest: (DigestLatest) -> Void = { _ in }
        var now: () -> Date = Date.init
        var loadLastSync: () -> Date? = { nil }
        var saveLastSync: (Date) -> Void = { _ in }
        var writeDelay: TimeInterval = SyncEngine.writeDelay
        var sleep: (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
    }

    @Published private(set) var status = SyncStatus()

    private let deps: Deps
    private var timer: Task<Void, Never>?
    private var retryTimer: Task<Void, Never>?
    private var rev = 0
    private var pending = false
    private var fails = 0
    private var active: Task<Void, Never>?
    private var again = false
    private var stopped = false
    /// Version der zuletzt gelesenen Wochenkarte, damit dieselbe Datei nicht noch einmal entschlüsselt wird
    private var digestSha: String?

    init(_ deps: Deps) {
        self.deps = deps
    }

    private func set(_ f: (inout SyncStatus) -> Void) {
        var s = status
        f(&s)
        if s != status { status = s }
    }

    // MARK: Ein Lauf

    private func attempt() async throws {
        let token = deps.token()
        set { $0.hasToken = token != nil }
        guard let token else {
            set { $0.error = nil }
            return
        }
        guard let cipher = deps.cipher() else {
            throw SyncError(kind: .setup, message: "Sync needs the unlock key on this device. Open your unlock link here once more.", status: nil)
        }
        for i in 0..<Self.maxAttempts {
            let remote = try await deps.transport.read(token: token)
            var remoteDoc: J?
            if let remote {
                let d = try cipher.decrypt(remote.text)
                if let v = d["v"]?.number, v > Double(SyncMerge.version) {
                    throw SyncError(kind: .format, message: "The sync file is from a newer version of Core. Update the app.", status: nil)
                }
                remoteDoc = d
            }
            guard let local = deps.local() else { return }
            let merged = remoteDoc.map { SyncMerge.merge(local, $0) } ?? local
            // Lokal fehlt etwas von GitHub: übernehmen
            if let r = remoteDoc, merged != local { deps.adopt(r) }
            if let r = remoteDoc, merged == r { return }
            do {
                let text = try cipher.encrypt(merged)
                _ = try await deps.transport.write(token: token, text: text, sha: remote?.sha, message: "core state \(Self.iso(deps.now()))")
                return
            } catch let e as SyncError where e.kind == .conflict {
                if i < Self.maxAttempts - 1 { continue }
                throw SyncError(kind: .server, message: "The sync file keeps changing. Will retry.", status: nil)
            }
        }
    }

    /// Wochenkarte laden. Sie ist optional: jeder Fehler (kein Netz, Datei fehlt, anderer Schlüssel) lässt den Sync unberührt, der nächste Lauf versucht es erneut.
    private func loadDigest() async {
        guard let token = deps.token(), let cipher = deps.cipher() else { return }
        do {
            guard let remote = try await deps.transport.readDigest(token: token), remote.sha != digestSha else { return }
            deps.adoptDigest(try cipher.decryptLatest(remote.text))
            digestSha = remote.sha
        } catch {
            // Wochenkarte bleibt, wie sie ist
        }
    }

    nonisolated static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    private func run() async {
        if stopped { return }
        if let active {
            again = true
            await active.value
            return
        }
        timer?.cancel()
        timer = nil
        let startRev = rev
        let task = Task { @MainActor in
            self.set { $0.running = true }
            do {
                try await self.attempt()
                await self.loadDigest()
                self.fails = 0
                self.retryTimer?.cancel()
                if self.rev == startRev { self.pending = false }
                if self.status.hasToken {
                    let t = self.deps.now()
                    self.set { $0.lastSync = t; $0.error = nil }
                    self.deps.saveLastSync(t)
                }
            } catch {
                let err = (error as? SyncError) ?? SyncError(kind: .server, message: "Sync failed. Will retry.", status: nil)
                self.set { $0.error = err.message }
                if err.retry {
                    self.fails += 1
                    self.retryTimer?.cancel()
                    let wait = Self.retryDelay(fails: self.fails)
                    self.retryTimer = Task { @MainActor in
                        await self.deps.sleep(wait)
                        if !Task.isCancelled { await self.run() }
                    }
                }
            }
            self.set { $0.running = false }
        }
        active = task
        await task.value
        active = nil
        if again {
            again = false
            if pending { await run() }
        }
    }

    // MARK: Von außen

    /// Etwas Synchronisiertes hat sich geändert: die zehn Sekunden beginnen von vorn
    func poke() {
        if stopped { return }
        rev += 1
        pending = true
        timer?.cancel()
        let wait = deps.writeDelay
        timer = Task { @MainActor in
            await self.deps.sleep(wait)
            if !Task.isCancelled { await self.run() }
        }
    }

    func syncNow() async { await run() }

    /// App kommt in den Vordergrund (true) oder geht (false)
    func visible(_ v: Bool) {
        if stopped { return }
        // Beim Verlassen sofort schreiben, was noch wartet. Beim Zurückkommen laden, was das andere Gerät geschrieben hat.
        if !v && !pending && timer == nil { return }
        Task { @MainActor in await self.run() }
    }

    func online() {
        if !stopped && (pending || status.error != nil) { Task { @MainActor in await self.run() } }
    }

    func tokenChanged() async {
        fails = 0
        let token = deps.token()
        set { $0.hasToken = token != nil; $0.error = nil }
        if token != nil { await run() }
    }

    func start() async {
        stopped = false
        let token = deps.token()
        let last = deps.loadLastSync()
        set { $0.hasToken = token != nil; $0.lastSync = last }
        if token != nil { await run() }
    }

    func stop() {
        stopped = true
        timer?.cancel()
        retryTimer?.cancel()
    }
}

/// "just now", "3 min ago", "2 h ago", "4 d ago". Gleiche Texte wie die Web-App (SyncCard.tsx).
enum SyncAgo {
    static func text(_ last: Date?, now: Date) -> String {
        guard let last else { return "not yet" }
        let s = max(0, Int(now.timeIntervalSince(last).rounded()))
        if s < 60 { return "just now" }
        let m = Int((Double(s) / 60).rounded())
        if m < 60 { return "\(m) min ago" }
        let h = Int((Double(m) / 60).rounded())
        if h < 48 { return "\(h) h ago" }
        return "\(Int((Double(h) / 24).rounded())) d ago"
    }
}
