import CryptoKit
import Foundation
import Security

/// Pool key in the iOS Keychain, download and decryption of the encrypted pool (AES-GCM 256, same format as the web app).
enum Vault {
    static let poolURL = URL(string: "https://amrsaad.github.io/core/moments/pool.enc")!
    private static let account = "core.pool.key"

    // MARK: Keychain

    /// Schlüsselsicherung (Max, 26.10.2026): Schlüssel im Keychain und als zweite Kopie in einer geschützten Datei.
    /// Fehlt eine Kopie, stellt die andere sie beim Start wieder her (gleiche Regel wie die Web-App, KeyBackup.plan).
    static func loadKey() -> Data? {
        if Env.isTest && Env.testUnlocked && keychainRead() == nil && fileRead() == nil { _ = saveKey(Data(repeating: 7, count: 32)) }
        if Env.isTest && !Env.testUnlocked { return nil }
        let plan = KeyBackup.plan(keychain: keychainRead(), file: fileRead())
        if let key = plan.key {
            if plan.writeKeychain { keychainWrite(key); Diag.log("key restored into keychain from file copy") }
            if plan.writeFile { fileWrite(key); Diag.log("key file copy written") }
        }
        return plan.key
    }

    /// Wo der Schlüssel liegt, für Settings
    static func backups() -> (keychain: Bool, file: Bool) {
        (keychainRead()?.count == 32, fileRead()?.count == 32)
    }

    @discardableResult
    static func saveKey(_ key: Data) -> Bool {
        fileWrite(key)
        return keychainWrite(key)
    }

    private static var keyFile: URL { Env.stateDir.appendingPathComponent("key.bin") }
    /// In UI-Tests steht eine Datei für den Keychain, damit die echte Wiederherstellung läuft, ohne den Keychain des Simulators zu benutzen
    private static var testKeychainFile: URL { Env.stateDir.appendingPathComponent("keychain-test.bin") }

    private static func fileRead() -> Data? { try? Data(contentsOf: keyFile) }

    private static func fileWrite(_ key: Data) {
        try? FileManager.default.createDirectory(at: keyFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? key.write(to: keyFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func keychainRead() -> Data? {
        if Env.isTest { return try? Data(contentsOf: testKeychainFile) }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    private static func keychainWrite(_ key: Data) -> Bool {
        if Env.isTest {
            try? FileManager.default.createDirectory(at: testKeychainFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            return (try? key.write(to: testKeychainFile)) != nil
        }
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = key
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    /// Reads the key from a pasted unlock link (…#k=<base64url>). Returns nil when the text holds no valid key.
    static func key(fromLink text: String) -> Data? {
        guard let range = text.range(of: #"k=([A-Za-z0-9_-]{40,})"#, options: .regularExpression) else { return nil }
        let value = String(text[range].dropFirst(2))
        guard let data = base64url(value), data.count == 32 else { return nil }
        return data
    }

    static func base64url(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        return Data(base64Encoded: b)
    }

    // MARK: Pool

    private struct Envelope: Decodable {
        let iv: String
        let ct: String
    }

    enum VaultError: LocalizedError, Equatable {
        case badFormat, wrongKey, http(Int)
        var errorDescription: String? {
            switch self {
            case .badFormat: return "The pool file has an unexpected format."
            case .wrongKey: return "The unlock link does not match this pool."
            case .http(let code): return "Could not load the pool (HTTP \(code))."
            }
        }
    }

    static func decrypt(_ data: Data, key: Data) throws -> Pool {
        let env = try JSONDecoder().decode(Envelope.self, from: data)
        guard let iv = base64url(env.iv), let ct = base64url(env.ct), ct.count > 16 else { throw VaultError.badFormat }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
            let plain = try AES.GCM.open(box, using: SymmetricKey(data: key))
            return try JSONDecoder().decode(Pool.self, from: plain)
        } catch is DecodingError {
            throw VaultError.badFormat
        } catch {
            throw VaultError.wrongKey
        }
    }

    private static var cacheFile: URL {
        Env.stateDir.appendingPathComponent("pool.enc")
    }

    /// Loads the newest pool. Offline it falls back to the last downloaded file.
    static func fetchPool(key: Data) async throws -> Pool {
        if let path = Env.testPoolFile {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            return try JSONDecoder().decode(Pool.self, from: data)
        }
        do {
            var request = URLRequest(url: poolURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode != 200 { throw VaultError.http(http.statusCode) }
            let pool = try decrypt(data, key: key)
            Diag.log("pool loaded: \(pool.moments.count) moments, \(pool.skipped) skipped, \(data.count) bytes")
            try? FileManager.default.createDirectory(at: cacheFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: cacheFile)
            return pool
        } catch VaultError.wrongKey {
            Diag.log("pool: wrong key")
            throw VaultError.wrongKey
        } catch {
            Diag.log("pool download failed: \(error.localizedDescription)")
            if let cached = try? Data(contentsOf: cacheFile), let pool = try? decrypt(cached, key: key) { return pool }
            throw error
        }
    }
}

/// Vertrag zwischen Pool und App, gleiche Regeln wie src/moments/contract.ts (Web) und core-content/pipeline/moments/build-enc.ts.
/// Ein ungültiger Moment wird aussortiert und gezählt, nie geworfen ("Invalid video id", 27.10.2026).
/// - Pflicht für alle: id, videoId, channel, hook nicht leer. form (falls gesetzt) video, audio oder text.
/// - form text braucht einen excerpt.
/// - form audio braucht hls und end nach start.
/// - form video braucht hls oder eine echte 11-stellige YouTube-ID und end nach start.
/// - Doppelte id: nur der erste zählt.
/// Ohne Feld form gilt wie in FormFilter: audio true heißt audio, sonst video.
enum PoolContract {
    static func isYouTubeID(_ id: String) -> Bool {
        id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil && !id.hasPrefix("pod-") && !id.hasPrefix("txt-")
    }

    private static func blank(_ s: String?) -> Bool {
        (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Grund, warum der Moment nicht in die App darf, oder nil
    static func violation(_ m: Moment) -> String? {
        if blank(m.id) { return "id fehlt" }
        if blank(m.videoId) { return "videoId fehlt" }
        if blank(m.channel) { return "channel fehlt" }
        if blank(m.hook) { return "hook fehlt" }
        let form: String
        if let f = m.form {
            guard ["video", "audio", "text"].contains(f) else { return "form ungültig" }
            form = f
        } else {
            form = m.isAudio ? "audio" : "video"
        }
        if form == "text" { return blank(m.excerpt) ? "text ohne excerpt" : nil }
        if !m.start.isFinite || !m.end.isFinite || !(m.end > m.start) { return "start oder end ungültig" }
        if m.hls != nil && blank(m.hls) { return "hls leer" }
        if form == "audio" { return blank(m.hls) ? "audio ohne hls" : nil }
        return (!blank(m.hls) || isYouTubeID(m.videoId)) ? nil : "video ohne hls und ohne YouTube-ID"
    }

    /// Abrufkarte mit falscher Form (nicht drei Antworten, Index außerhalb) entfällt, der Moment bleibt
    private static func cleaned(_ m: Moment) -> Moment {
        guard let r = m.recall, !(r.options.count == 3 && (0..<3).contains(r.correct)) else { return m }
        var out = m
        out.recall = nil
        return out
    }

    static func validate(_ list: [Moment]) -> (moments: [Moment], skipped: Int, reasons: [String: Int]) {
        var out: [Moment] = []
        var seen = Set<String>()
        var skipped = 0
        var reasons: [String: Int] = [:]
        func skip(_ why: String) {
            skipped += 1
            reasons[why, default: 0] += 1
        }
        for m in list {
            if let why = violation(m) { skip(why); continue }
            if !seen.insert(m.id).inserted { skip("doppelte id"); continue }
            out.append(cleaned(m))
        }
        return (out, skipped, reasons)
    }
}
