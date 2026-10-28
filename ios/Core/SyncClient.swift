import CryptoKit
import Foundation
import Network

// Geräte-Sync (Auftrag Max 28.10.2026), Teil 4: Verschlüsselung (CryptoKit), GitHub Contents API (URLSession), Netzwächter.
// Dateiformat wie pool.enc und die Web-App: {"v":1,"iv":b64url,"ct":b64url(Chiffretext + 16 Byte Tag)}, AES-GCM 256 mit dem Pool-Schlüssel.
// Das Token steht nie im Code. Einzige Netzadresse: api.github.com.

struct SyncCrypto: SyncCipher {
    let key: Data

    private var symmetric: SymmetricKey { SymmetricKey(data: key) }

    private func b64u(_ d: Data) -> String { KeyBackup.base64url(d) }

    private func seal(_ plain: Data) throws -> (iv: Data, ct: Data) {
        let box = try AES.GCM.seal(plain, using: symmetric)
        let iv = box.nonce.withUnsafeBytes { Data($0) }
        return (iv, box.ciphertext + box.tag)
    }

    private func open(iv: Data, ct: Data) throws -> Data {
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
        return try AES.GCM.open(box, using: symmetric)
    }

    func encrypt(_ doc: J) throws -> String {
        let s = try seal(SyncJSON.data(doc))
        var env = [String: J]()
        env["v"] = .num(1)
        env["iv"] = .str(b64u(s.iv))
        env["ct"] = .str(b64u(s.ct))
        return SyncJSON.canon(.obj(env))
    }

    func decrypt(_ text: String) throws -> J {
        let bad = SyncError(kind: .format, message: "The sync file has an unexpected format.", status: nil)
        guard let env = SyncJSON.parse(text), let ivText = env["iv"]?.string, let ctText = env["ct"]?.string,
              let iv = Vault.base64url(ivText), let ct = Vault.base64url(ctText), iv.count == 12, ct.count > 16 else { throw bad }
        let plain: Data
        do {
            plain = try open(iv: iv, ct: ct)
        } catch {
            throw SyncError(kind: .key, message: "The sync file does not match this unlock key.", status: nil)
        }
        guard let doc = SyncJSON.parse(plain), doc.object != nil, doc["state"]?.object != nil else { throw bad }
        return doc
    }

    /// Token für den QR-Code: base64url(iv + Chiffretext + Tag), wie in der Web-App
    func encryptToken(_ token: String) -> String? {
        guard let s = try? seal(Data(token.utf8)) else { return nil }
        return b64u(s.iv + s.ct)
    }

    func decryptToken(_ text: String) -> String? {
        guard let all = Vault.base64url(text), all.count > 12 + 16 else { return nil }
        guard let plain = try? open(iv: all.prefix(12), ct: all.dropFirst(12)), let t = String(data: plain, encoding: .utf8) else { return nil }
        return Vault.tokenLooksValid(t) ? t : nil
    }
}

/// Contents API für eine Datei in core-content (Standard-Branch)
struct GitHubTransport: SyncTransport {
    static let host = "https://api.github.com"
    static let repo = "amrsaad/core-content"
    static let path = "state/core-state.enc"

    var session: URLSession

    /// Die App-Sitzung. In UI-Tests (CORE_SYNC_MOCK) antwortet eine nachgebaute API im Prozess statt GitHub.
    static func app() -> GitHubTransport {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        if SyncMock.enabled { config.protocolClasses = [SyncMockProtocol.self] }
        return GitHubTransport(session: URLSession(configuration: config))
    }

    /// Sitzung gegen die nachgebaute API, für Unit-Tests
    static func mocked() -> GitHubTransport {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SyncMockProtocol.self]
        return GitHubTransport(session: URLSession(configuration: config))
    }

    private func request(_ url: String, token: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: URL(string: url)!)
        r.httpMethod = method
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = body
        }
        return r
    }

    private func send(_ r: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, resp) = try await session.data(for: r)
            guard let http = resp as? HTTPURLResponse else { throw SyncError.unexpected }
            return (data, http)
        } catch let e as SyncError {
            throw e
        } catch {
            throw SyncError.offline
        }
    }

    private func rateLimited(_ h: HTTPURLResponse) -> Bool { h.value(forHTTPHeaderField: "x-ratelimit-remaining") == "0" }

    private func text(fromBase64 s: String) -> String? {
        guard let d = Data(base64Encoded: s, options: .ignoreUnknownCharacters) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    func read(token: String) async throws -> SyncRemote? {
        let (data, http) = try await send(request("\(Self.host)/repos/\(Self.repo)/contents/\(Self.path)", token: token))
        if http.statusCode == 404 { return nil }
        guard http.statusCode == 200 else { throw SyncError.failure(status: http.statusCode, rateLimited: rateLimited(http)) }
        guard let j = SyncJSON.parse(data), let sha = j["sha"]?.string else { throw SyncError.unexpected }
        if j["encoding"]?.string == "base64", let c = j["content"]?.string, !c.isEmpty || j["size"]?.number == 0 {
            guard let t = text(fromBase64: c) else { throw SyncError.unexpected }
            return SyncRemote(text: t, sha: sha)
        }
        // Dateien über 1 MB liefert die Contents API ohne Inhalt, dann über den Blob
        let (bdata, bhttp) = try await send(request("\(Self.host)/repos/\(Self.repo)/git/blobs/\(sha)", token: token))
        guard bhttp.statusCode == 200 else { throw SyncError.failure(status: bhttp.statusCode, rateLimited: rateLimited(bhttp)) }
        guard let b = SyncJSON.parse(bdata), b["encoding"]?.string == "base64", let c = b["content"]?.string, let t = text(fromBase64: c) else { throw SyncError.unexpected }
        return SyncRemote(text: t, sha: sha)
    }

    func write(token: String, text: String, sha: String?, message: String) async throws -> String {
        var body = [String: J]()
        body["message"] = .str(message)
        body["content"] = .str(Data(text.utf8).base64EncodedString())
        if let sha { body["sha"] = .str(sha) }
        let (data, http) = try await send(request("\(Self.host)/repos/\(Self.repo)/contents/\(Self.path)", token: token, method: "PUT", body: SyncJSON.data(.obj(body))))
        guard (200..<300).contains(http.statusCode) else { throw SyncError.failure(status: http.statusCode, rateLimited: rateLimited(http)) }
        return SyncJSON.parse(data)?["content"]?["sha"]?.string ?? ""
    }
}

extension SyncEngine {
    /// Der Sync der App: Zustand aus dem Store, Schlüssel aus dem Vault, Token aus dem Keychain
    static func app() -> SyncEngine {
        var deps = Deps(
            transport: GitHubTransport.app(),
            cipher: { Vault.loadKey().map { SyncCrypto(key: $0) } },
            token: { Vault.loadToken() },
            local: { Store.current?.syncDoc() },
            adopt: { Store.current?.adopt($0) }
        )
        deps.loadLastSync = { SyncMeta.load() }
        deps.saveLastSync = { SyncMeta.save($0) }
        return SyncEngine(deps)
    }

    /// Token aus dem Feld in Settings übernehmen. false, wenn es nicht wie ein GitHub-Token aussieht.
    func setToken(_ raw: String) async -> Bool {
        guard Vault.saveToken(raw) else { return false }
        await tokenChanged()
        return true
    }

    func removeToken() async {
        Vault.clearToken()
        await tokenChanged()
    }
}

/// Zeitpunkt des letzten erfolgreichen Syncs, getrennt vom Nutzungsstand (wandert nicht, steht nicht im Export)
enum SyncMeta {
    private static var file: URL { Env.stateDir.appendingPathComponent("sync-meta.json") }

    static func load() -> Date? {
        guard let d = try? Data(contentsOf: file), let j = SyncJSON.parse(d), let ms = j["lastSync"]?.number else { return nil }
        return SyncWire.date(ms)
    }

    static func save(_ date: Date) {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? SyncJSON.data(.obj(["lastSync": .num(SyncWire.ms(date))])).write(to: file, options: .atomic)
    }
}

/// Meldet, wenn das Netz zurückkommt, damit liegengebliebene Änderungen nachgeholt werden
final class NetWatch {
    private let monitor = NWPathMonitor()

    init(onOnline: @escaping @MainActor () -> Void) {
        var wasUp = true
        monitor.pathUpdateHandler = { path in
            let up = path.status == .satisfied
            if up && !wasUp { Task { @MainActor in onOnline() } }
            wasUp = up
        }
        monitor.start(queue: DispatchQueue(label: "core.netwatch"))
    }

    deinit { monitor.cancel() }
}

// MARK: Nachgebaute GitHub API für UI-Tests

/// Nur aktiv mit CORE_SYNC_MOCK=<Token>. Die Datei liegt in <Zustandsordner>/mock-github/, damit der Test sie vorbereiten und lesen kann.
/// Steuerdatei mode im selben Ordner: offline, unauthorized oder conflict (der nächste Schreibvorgang trifft eine geänderte sha, einmalig).
enum SyncMock {
    /// Unit-Tests setzen diese beiden Werte direkt, UI-Tests über die Umgebung
    static var tokenOverride: String?
    static var dirOverride: URL?
    static var token: String? { tokenOverride ?? Env.values["CORE_SYNC_MOCK"] }
    static var enabled: Bool { token != nil }
    static var dir: URL { dirOverride ?? Env.stateDir.appendingPathComponent("mock-github", isDirectory: true) }
    static var fileURL: URL { dir.appendingPathComponent("state.enc") }
    static var shaURL: URL { dir.appendingPathComponent("sha.txt") }
    static var modeURL: URL { dir.appendingPathComponent("mode.txt") }
    static var putsURL: URL { dir.appendingPathComponent("puts.txt") }

    static func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
    static func write(_ url: URL, _ s: String) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? s.write(to: url, atomically: true, encoding: .utf8)
    }
}

final class SyncMockProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "api.github.com" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    private func reply(_ status: Int, _ body: J) {
        let data = SyncJSON.data(body)
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func startLoading() {
        let mode = SyncMock.read(SyncMock.modeURL)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if mode == "offline" {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let auth = request.value(forHTTPHeaderField: "Authorization")
        guard mode != "unauthorized", let token = SyncMock.token, auth == "Bearer \(token)" else { return reply(401, .obj([:])) }
        guard request.url?.path.hasSuffix("/contents/state/core-state.enc") == true else { return reply(404, .obj([:])) }
        let text = SyncMock.read(SyncMock.fileURL)
        let sha = SyncMock.read(SyncMock.shaURL) ?? ""
        if request.httpMethod == "GET" || request.httpMethod == nil {
            guard let text else { return reply(404, .obj([:])) }
            return reply(200, .obj(["sha": .str(sha), "size": .num(Double(text.utf8.count)), "encoding": .str("base64"), "content": .str(Data(text.utf8).base64EncodedString())]))
        }
        guard request.httpMethod == "PUT" else { return reply(405, .obj([:])) }
        if mode == "conflict" {
            // Ein anderes Gerät hat dazwischen geschrieben: die sha ändert sich, der erste Versuch bekommt 409
            SyncMock.write(SyncMock.shaURL, "other-\(UUID().uuidString.prefix(8))")
            SyncMock.write(SyncMock.modeURL, "")
            return reply(409, .obj([:]))
        }
        var bodyData = request.httpBody
        if bodyData == nil, let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 65536)
            var d = Data()
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                d.append(buf, count: n)
            }
            stream.close()
            bodyData = d
        }
        guard let bodyData, let body = SyncJSON.parse(bodyData), let content = body["content"]?.string, let raw = Data(base64Encoded: content), let newText = String(data: raw, encoding: .utf8) else { return reply(422, .obj([:])) }
        let given = body["sha"]?.string
        if (text == nil && given != nil) || (text != nil && given != sha) { return reply(text == nil ? 422 : 409, .obj([:])) }
        let newSha = "sha-\(UUID().uuidString.prefix(8))"
        SyncMock.write(SyncMock.fileURL, newText)
        SyncMock.write(SyncMock.shaURL, newSha)
        SyncMock.write(SyncMock.putsURL, "\((Int(SyncMock.read(SyncMock.putsURL) ?? "0") ?? 0) + 1)")
        reply(200, .obj(["content": .obj(["sha": .str(newSha)])]))
    }
}
