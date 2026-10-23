import CryptoKit
import Foundation
import Security

/// Pool key in the iOS Keychain, download and decryption of the encrypted pool (AES-GCM 256, same format as the web app).
enum Vault {
    static let poolURL = URL(string: "https://amrsaad.github.io/core/moments/pool.enc")!
    private static let account = "core.pool.key"

    // MARK: Keychain

    static func loadKey() -> Data? {
        if Env.isTest { return Env.testUnlocked ? Data(repeating: 7, count: 32) : nil }
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
    static func saveKey(_ key: Data) -> Bool {
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
            Diag.log("pool loaded: \(pool.moments.count) moments, \(data.count) bytes")
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
