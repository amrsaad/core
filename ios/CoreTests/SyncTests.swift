import CryptoKit
import XCTest
@testable import Core

/// Geräte-Sync (Max 28.10.2026). Gleiche Prüfdaten wie die Web-Tests: tests/fixtures/sync-vectors.json, sync-random.json, sync-file.json
final class SyncTests: XCTestCase {
    private static let fixtures: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures", isDirectory: true)

    private func load(_ name: String) throws -> J {
        let data = try Data(contentsOf: Self.fixtures.appendingPathComponent(name))
        return try XCTUnwrap(SyncJSON.parse(data), "\(name) lässt sich nicht lesen")
    }

    // MARK: Zusammenführung

    func testMergeFixturesBothDirections() throws {
        var count = 0
        for file in ["sync-vectors.json", "sync-random.json"] {
            let list = try XCTUnwrap(load(file).array)
            XCTAssertGreaterThan(list.count, 10)
            for (i, c) in list.enumerated() {
                let a = try XCTUnwrap(c["a"]), b = try XCTUnwrap(c["b"]), expected = try XCTUnwrap(c["expected"])
                let name = c["name"]?.string ?? "\(file)#\(i)"
                XCTAssertEqual(SyncMerge.merge(a, b), expected, "\(name) a,b")
                XCTAssertEqual(SyncMerge.merge(b, a), expected, "\(name) b,a")
                XCTAssertEqual(SyncMerge.merge(expected, expected), expected, "\(name) idempotent")
                XCTAssertEqual(SyncJSON.parse(SyncJSON.canon(expected)), expected, "\(name) Hin und zurück")
                count += 1
            }
        }
        XCTAssertEqual(count, 69)
    }

    func testJSONUnicodeAndNumbers() throws {
        let j = try XCTUnwrap(SyncJSON.parse(#"{"a":"Kanal ä ä 😀 \n","b":[1,2.5,-3,1e3],"c":null,"d":true}"#))
        XCTAssertEqual(j["a"]?.string, "Kanal ä ä 😀 \n")
        XCTAssertEqual(SyncJSON.canon(j), #"{"a":"Kanal ä ä 😀 \n","b":[1,2.5,-3,1000],"c":null,"d":true}"#)
        XCTAssertEqual(SyncMerge.cmp("a", "b"), -1)
        // JavaScript vergleicht UTF-16: ein Zeichen außerhalb der Basisebene ist kleiner als U+FF5E
        XCTAssertEqual(SyncMerge.cmp("😀", "\u{FF5E}"), -1)
        XCTAssertNil(SyncJSON.parse("{\"a\":"))
    }

    // MARK: Zustand und Dokument

    func testTypeScriptDocumentsSurviveAppState() throws {
        for file in ["sync-vectors.json", "sync-random.json"] {
            for (i, c) in try XCTUnwrap(load(file).array).enumerated() {
                for key in ["a", "b", "expected"] {
                    let d = SyncMerge.normalized(try XCTUnwrap(c[key]))
                    var back = try XCTUnwrap(SyncWire.doc(from: SyncWire.apply(d, to: AppState())).object)
                    // Die App hat immer areaShares (Standard), die Web-App nur, wenn gewählt
                    var state = try XCTUnwrap(back["state"]?.object)
                    var settings = try XCTUnwrap(state["settings"]?.object)
                    if d["state"]?["settings"]?["areaShares"] == nil { settings["areaShares"] = nil }
                    state["settings"] = .obj(settings)
                    back["state"] = .obj(state)
                    XCTAssertEqual(J.obj(back), d, "\(file)#\(i) \(key)")
                }
            }
        }
    }

    func testTwoDevicesConverge() {
        var a = AppState(), b = AppState()
        a.seen["m1"] = Date(timeIntervalSince1970: 100)
        b.seen["m2"] = Date(timeIntervalSince1970: 200)
        a.weights.topic["augen"] = 1.5
        b.weights.topic["kraft"] = 0.8
        a.feedTime["2026-10-28"] = 60
        b.feedTime["2026-10-28"] = 90.5
        a.liked = ["m1": Date(timeIntervalSince1970: 50)]
        let merged = SyncMerge.merge(SyncWire.doc(from: a), SyncWire.doc(from: b))
        let na = SyncWire.apply(merged, to: a), nb = SyncWire.apply(merged, to: b)
        XCTAssertEqual(na.seen.keys.sorted(), ["m1", "m2"])
        XCTAssertEqual(na.weights.topic, ["augen": 1.5, "kraft": 0.8])
        XCTAssertEqual(na.feedTime["2026-10-28"], 90.5)
        XCTAssertEqual(SyncWire.doc(from: na), SyncWire.doc(from: nb))
    }

    func testStampingAndDeletion() {
        let now = Date(timeIntervalSince1970: 1_000)
        let base = AppState()
        XCTAssertEqual(SyncWire.stamp(old: base, new: base, now: now), base)
        var n = base
        n.weights.topic["t"] = 1.2
        n.captionMode = .on
        n.muted["c"] = "c"
        n.liked = ["l": now]
        let s1 = SyncWire.stamp(old: base, new: n, now: now)
        XCTAssertEqual(s1.syncTs, ["w:topic:t": 1_000_000, "set:captionMode": 1_000_000, "muted:c": 1_000_000, "liked:l": 1_000_000])
        var d = s1
        d.muted["c"] = nil
        d.weights = Weights()
        let s2 = SyncWire.stamp(old: s1, new: d, now: Date(timeIntervalSince1970: 2_000))
        XCTAssertEqual(s2.syncTs?["muted:c"], 2_000_000)
        // Das andere Gerät hat noch den alten Stand: das Löschen bleibt
        let merged = SyncMerge.merge(SyncWire.doc(from: s2), SyncWire.doc(from: s1))
        let applied = SyncWire.apply(merged, to: s2)
        XCTAssertTrue(applied.muted.isEmpty)
        XCTAssertTrue(applied.weights.topic.isEmpty)
        var device = base
        device.tapMs = []
        device.captions = false
        XCTAssertFalse(SyncWire.syncedChanged(base, device), "Gerätespezifisches wandert nicht")
        XCTAssertTrue(SyncWire.syncedChanged(base, n))
    }

    // MARK: Core Digest

    private func latestJSON(week: String = "2026-W44") -> String {
        #"{"v":1,"week":"\#(week)","generatedAt":"2026-11-01T04:48:00.000Z","saves":13,"counts":{"action":2,"habit":0,"rule":4,"know":9,"research":1,"content":1,"script":1,"source":1,"contradiction":0},"actions":[{"id":"ted-2034:278.2","title":"Record a short talk opening twice, once from the chest","metric":"Both recordings exist","due":"2026-11-09","url":null},{"id":"bad"}],"contradictions":[{"id":"c1","otherId":"c2","question":"Which one holds?","a":"Rule A","b":"Rule B"}]}"#
    }

    func testDigestParseAndTaps() throws {
        let latest = try XCTUnwrap(DigestCard.parse(try XCTUnwrap(SyncJSON.parse(latestJSON()))))
        XCTAssertEqual(latest.week, "2026-W44")
        XCTAssertEqual(latest.saves, 13)
        XCTAssertEqual(latest.actions.count, 1, "Eintrag ohne Pflichtfelder fällt weg")
        XCTAssertEqual(latest.contradictions.count, 1)
        XCTAssertEqual(DigestCard.countList(latest).map { "\($0.kind) \($0.n)" }, ["action 2", "rule 4", "know 9", "research 1", "content 1", "script 1", "source 1"])
        XCTAssertNil(DigestCard.parse(try XCTUnwrap(SyncJSON.parse(#"{"v":2,"week":"x","generatedAt":"2026-11-01T04:48:00Z"}"#))))
        XCTAssertNil(DigestCard.parse(try XCTUnwrap(SyncJSON.parse(#"{"v":1,"week":"x","generatedAt":"gestern"}"#))))

        XCTAssertEqual(DigestCard.dueDate("2026-11-09"), "Nov 9")
        XCTAssertEqual(DigestCard.lastLine(nil, nil), "Last digest: none yet")
        XCTAssertTrue(DigestCard.lastLine(latest, nil).hasSuffix(", 1 action open"))
        let key = DigestCard.actionKey("ted-2034:278.2")
        var taps = DigestCard.setTap(nil, key: key, choice: "done", now: 5)
        XCTAssertEqual(taps[key], DigestTap(choice: "done", at: 5))
        XCTAssertEqual(DigestCard.setTap(taps, key: key, choice: "done", now: 9), taps, "gleiche Wahl ändert nichts")
        XCTAssertEqual(DigestCard.setTap(taps, key: key, choice: "a", now: 9), taps, "falsche Wahl für diese Art")
        taps = DigestCard.setTap(taps, key: key, choice: "drop", now: 9)
        XCTAssertEqual(DigestCard.actionTap(taps, "ted-2034:278.2"), "drop")
        XCTAssertEqual(DigestCard.openActions(latest, taps), 0)
        XCTAssertTrue(DigestCard.lastLine(latest, taps).hasSuffix(", 0 actions open"))
    }

    func testDigestTapsStampSyncAndMerge() {
        let now = Date(timeIntervalSince1970: 1_000)
        var s = AppState()
        s.digestTaps = ["a:m1": DigestTap(choice: "done", at: 100), "c:m3": DigestTap(choice: "a", at: 300)]
        let stamped = SyncWire.stamp(old: AppState(), new: s, now: now)
        XCTAssertEqual(stamped.syncTs, ["digest:a:m1": 1_000_000, "digest:c:m3": 1_000_000])
        XCTAssertTrue(SyncWire.syncedChanged(AppState(), stamped))
        // die geladene Wochenkarte selbst wandert nicht
        var l = AppState()
        l.digestLatest = DigestCard.parse(SyncJSON.parse(latestJSON())!)
        XCTAssertFalse(SyncWire.syncedChanged(AppState(), l))
        XCTAssertEqual(SyncWire.stamp(old: AppState(), new: l, now: now), l)
        XCTAssertFalse(SyncJSON.canon(SyncWire.doc(from: l)).contains("2026-W44"))
        // zweites Gerät tippt später auf dieselbe Action: der spätere Tap gilt auf beiden
        var other = AppState()
        other.digestTaps = ["a:m1": DigestTap(choice: "drop", at: 200)]
        other = SyncWire.stamp(old: AppState(), new: other, now: Date(timeIntervalSince1970: 2_000))
        let merged = SyncMerge.merge(SyncWire.doc(from: stamped), SyncWire.doc(from: other))
        let a = SyncWire.apply(merged, to: stamped)
        XCTAssertEqual(a.digestTaps?["a:m1"], DigestTap(choice: "drop", at: 200))
        XCTAssertEqual(a.digestTaps?["c:m3"], DigestTap(choice: "a", at: 300))
        XCTAssertEqual(SyncWire.doc(from: SyncWire.apply(merged, to: other)), SyncWire.doc(from: a))
    }

    @MainActor
    func testDigestFileAndEngineLoad() async throws {
        _ = useMock()
        let token = "github_pat_UNITTESTTOKEN0123456789_abcdef"
        let key = Data(repeating: 9, count: 32)
        // Datei wie die Aufgabe sie schreibt: {v, iv, ct} mit AES-GCM
        let box = try AES.GCM.seal(Data(latestJSON().utf8), using: SymmetricKey(data: key))
        let iv = box.nonce.withUnsafeBytes { Data($0) }
        let env = J.obj(["v": .num(1), "iv": .str(KeyBackup.base64url(iv)), "ct": .str(KeyBackup.base64url(box.ciphertext + box.tag))])
        let file = SyncJSON.canon(env)
        let latest = try SyncCrypto(key: key).decryptLatest(file)
        XCTAssertEqual(latest.week, "2026-W44")
        do {
            _ = try SyncCrypto(key: Data(repeating: 1, count: 32)).decryptLatest(file)
            XCTFail("falscher Schlüssel")
        } catch let e as SyncError {
            XCTAssertEqual(e.kind, .key)
        }

        // Der Ablauf lädt die Karte nach dem Sync, nur einmal je Version, und ein Fehler stört den Sync nicht
        SyncMock.write(SyncMock.digestURL, file)
        final class Box { var adopted: [DigestLatest] = [] }
        let seen = Box()
        var deps = SyncEngine.Deps(
            transport: GitHubTransport.mocked(),
            cipher: { SyncCrypto(key: key) },
            token: { token },
            local: { SyncMerge.emptyDoc() },
            adopt: { _ in }
        )
        deps.adoptDigest = { seen.adopted.append($0) }
        let engine = SyncEngine(deps)
        await engine.syncNow()
        await engine.syncNow()
        XCTAssertEqual(seen.adopted.map(\.week), ["2026-W44"], "dieselbe Version nur einmal")
        XCTAssertNil(engine.status.error)
        SyncMock.write(SyncMock.digestURL, "kein json")
        await engine.syncNow()
        XCTAssertNil(engine.status.error, "kaputte Wochenkarte stört den Sync nicht")
        XCTAssertEqual(seen.adopted.count, 1)
    }

    func testSavedMomentRoundTrip() throws {
        let json = #"{"id":"a:1","videoId":"vid","start":10,"end":70,"channel":"K (P)","videoTitle":"T","area":"brain","topic":"augen","hook":"H","kind":"regel","createdAt":"2026-10-20T00:00:00Z","cues":[[0,"eins"]],"recall":{"question":"Q","options":["a","b","c"],"correct":1,"why":"w"}}"#
        let m = try JSONDecoder().decode(Moment.self, from: Data(json.utf8))
        var s = AppState()
        s.saved["a:1"] = SavedMoment(moment: m, savedAt: Date(timeIntervalSince1970: 1_761_000_000.123), done: true)
        let d = SyncWire.doc(from: s)
        XCTAssertEqual(d["state"]?["savedMoments"]?["a:1"]?["savedAt"]?.string, "2025-10-20T22:40:00.123Z")
        XCTAssertEqual(d["state"]?["savedMoments"]?["a:1"]?["moment"]?["createdAt"]?.string, "2026-10-20T00:00:00Z")
        let back = SyncWire.apply(d, to: AppState())
        XCTAssertEqual(back.saved["a:1"]?.moment, m)
        XCTAssertEqual(back.saved["a:1"]?.done, true)
    }

    // MARK: Verschlüsselung

    func testOpensFileFromTypeScript() throws {
        let f = try load("sync-file.json")
        let key = try XCTUnwrap(Vault.base64url(try XCTUnwrap(f["key"]?.string)))
        let crypto = SyncCrypto(key: key)
        XCTAssertEqual(try crypto.decrypt(try XCTUnwrap(f["file"]?.string)), f["doc"])
        XCTAssertEqual(crypto.decryptToken(try XCTUnwrap(f["encToken"]?.string)), f["token"]?.string)
    }

    func testEncryptRoundTripAndWrongKey() throws {
        let key = Data((0..<32).map { UInt8($0) })
        let other = Data((1..<33).map { UInt8($0) })
        let doc = SyncMerge.emptyDoc()
        let text = try SyncCrypto(key: key).encrypt(doc)
        let env = try XCTUnwrap(SyncJSON.parse(text))
        XCTAssertEqual(env.object?.keys.sorted(), ["ct", "iv", "v"])
        XCTAssertEqual(Vault.base64url(try XCTUnwrap(env["iv"]?.string))?.count, 12)
        XCTAssertFalse(text.contains("momentSeen"))
        XCTAssertEqual(try SyncCrypto(key: key).decrypt(text), doc)
        XCTAssertThrowsError(try SyncCrypto(key: other).decrypt(text)) { XCTAssertEqual(($0 as? SyncError)?.kind, .key) }
        XCTAssertThrowsError(try SyncCrypto(key: key).decrypt("{\"v\":1}")) { XCTAssertEqual(($0 as? SyncError)?.kind, .format) }
        // Token: Hin und zurück, Klartext nicht im Ergebnis, QR-Link nimmt es mit
        let token = "github_pat_UNITTESTTOKEN0123456789_abcdef"
        let enc = try XCTUnwrap(SyncCrypto(key: key).encryptToken(token))
        XCTAssertFalse(enc.contains(token))
        XCTAssertEqual(SyncCrypto(key: key).decryptToken(enc), token)
        XCTAssertNil(SyncCrypto(key: other).decryptToken(enc))
        let link = KeyBackup.link(key, encryptedToken: enc)
        XCTAssertEqual(Vault.key(fromLink: link), key)
        XCTAssertEqual(Vault.token(fromLink: link, key: key), token)
        XCTAssertEqual(KeyBackup.link(key, encryptedToken: nil), KeyBackup.link(key))
        XCTAssertNil(Vault.token(fromLink: KeyBackup.link(key), key: key))
        XCTAssertTrue(Vault.tokenLooksValid(token))
        XCTAssertFalse(Vault.tokenLooksValid("zu kurz"))
    }

    func testAgoText() {
        let now = Date(timeIntervalSince1970: 100_000)
        XCTAssertEqual(SyncAgo.text(nil, now: now), "not yet")
        XCTAssertEqual(SyncAgo.text(now.addingTimeInterval(-20), now: now), "just now")
        XCTAssertEqual(SyncAgo.text(now.addingTimeInterval(-180), now: now), "3 min ago")
        XCTAssertEqual(SyncAgo.text(now.addingTimeInterval(-7_200), now: now), "2 h ago")
        XCTAssertEqual(SyncAgo.text(now.addingTimeInterval(-4 * 86_400), now: now), "4 d ago")
    }

    // MARK: GitHub-Client gegen die nachgebaute API

    private func useMock(token: String = "github_pat_UNITTESTTOKEN0123456789_abcdef") -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("core-sync-\(UUID().uuidString)", isDirectory: true)
        SyncMock.dirOverride = dir
        SyncMock.tokenOverride = token
        addTeardownBlock {
            SyncMock.dirOverride = nil
            SyncMock.tokenOverride = nil
        }
        return dir
    }

    @MainActor
    func testTransportCreateReadConflictAndErrors() async throws {
        _ = useMock()
        let token = "github_pat_UNITTESTTOKEN0123456789_abcdef"
        let api = GitHubTransport.mocked()
        let none = try await api.read(token: token)
        XCTAssertNil(none, "404 heißt keine Datei")
        let sha1 = try await api.write(token: token, text: "äöü ✓", sha: nil, message: "m")
        let got = try await api.read(token: token)
        XCTAssertEqual(got, SyncRemote(text: "äöü ✓", sha: sha1))
        let sha2 = try await api.write(token: token, text: "b", sha: sha1, message: "m")
        XCTAssertNotEqual(sha1, sha2)
        do {
            _ = try await api.write(token: token, text: "c", sha: sha1, message: "m")
            XCTFail("alte sha muss ein Konflikt sein")
        } catch let e as SyncError {
            XCTAssertEqual(e.kind, .conflict)
        }
        do {
            _ = try await api.read(token: "github_pat_ANDERESTOKENANDERES999")
            XCTFail("falsches Token")
        } catch let e as SyncError {
            XCTAssertEqual(e.kind, .auth)
            XCTAssertFalse(e.retry)
            XCTAssertFalse(e.message.contains("github_pat"))
            XCTAssertFalse(e.message.contains("\n"))
        }
        SyncMock.write(SyncMock.modeURL, "offline")
        do {
            _ = try await api.read(token: token)
            XCTFail("offline")
        } catch let e as SyncError {
            XCTAssertEqual(e.kind, .offline)
            XCTAssertTrue(e.retry)
        }
    }

    // MARK: Ablauf mit zwei Geräten

    @MainActor
    private final class Device {
        var doc = SyncMerge.emptyDoc()
        var engine: SyncEngine!
        init(key: Data, token: String?, delay: TimeInterval) {
            var deps = SyncEngine.Deps(
                transport: GitHubTransport.mocked(),
                cipher: { SyncCrypto(key: key) },
                token: { token },
                local: { [unowned self] in self.doc },
                adopt: { [unowned self] r in self.doc = SyncMerge.normalized(SyncMerge.merge(self.doc, r)) }
            )
            deps.writeDelay = delay
            engine = SyncEngine(deps)
        }

        func see(_ id: String) {
            var o = doc.object ?? [:]
            var s = o["state"]?.object ?? [:]
            var m = s["momentSeen"]?.object ?? [:]
            m[id] = .num(1)
            s["momentSeen"] = .obj(m)
            o["state"] = .obj(s)
            doc = .obj(o)
            engine.poke()
        }

        var ids: [String] { (doc["state"]?["momentSeen"]?.object ?? [:]).keys.sorted() }
    }

    @MainActor
    func testTwoDevicesThroughTheMockApi() async throws {
        _ = useMock()
        let token = "github_pat_UNITTESTTOKEN0123456789_abcdef"
        let key = Data(repeating: 7, count: 32)
        let a = Device(key: key, token: token, delay: 0.2)
        let b = Device(key: key, token: token, delay: 0.2)
        a.see("von-a")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNil(SyncMock.read(SyncMock.putsURL), "vor Ablauf der Ruhezeit wird nicht geschrieben")
        try await Task.sleep(nanoseconds: 800_000_000)
        XCTAssertEqual(SyncMock.read(SyncMock.putsURL), "1")
        XCTAssertNil(a.engine.status.error)
        XCTAssertNotNil(a.engine.status.lastSync)
        b.see("von-b")
        await b.engine.start()
        XCTAssertEqual(b.ids, ["von-a", "von-b"], "b lädt und vereinigt")
        await b.engine.syncNow()
        await a.engine.start()
        XCTAssertEqual(a.ids, ["von-a", "von-b"], "a holt b nach")
        // Konflikt: die sha ändert sich zwischen Lesen und Schreiben
        a.see("a2")
        SyncMock.write(SyncMock.modeURL, "conflict")
        await a.engine.syncNow()
        XCTAssertNil(a.engine.status.error, "Konflikt wird gelöst: laden, mergen, schreiben")
        let remote = try XCTUnwrap(SyncMock.read(SyncMock.fileURL))
        let doc = try SyncCrypto(key: key).decrypt(remote)
        XCTAssertEqual((doc["state"]?["momentSeen"]?.object ?? [:]).keys.sorted(), ["a2", "von-a", "von-b"])
        // Fehlerzeile ohne Token im Text
        SyncMock.write(SyncMock.modeURL, "unauthorized")
        a.see("a3")
        await a.engine.syncNow()
        XCTAssertEqual(a.engine.status.error, "GitHub rejected the token (401). Paste a new one.")
    }
}
