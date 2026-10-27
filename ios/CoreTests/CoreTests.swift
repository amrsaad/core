import CryptoKit
import XCTest
@testable import Core

/// Same rules as the web app tests (tests/video-mix.test.ts, moments-mix.test.ts).
final class MixTests: XCTestCase {
    private func moment(_ id: String, _ area: Area, topic: String, channel: String, top: Bool = false) -> Moment {
        Moment(id: id, videoId: id, start: 0, end: 60, channel: channel, videoTitle: nil, area: area, topic: topic,
               hook: "Hook \(id)", forYou: nil, kind: "story", top: top, hls: nil, thumb: nil, url: nil, audio: nil, cues: nil)
    }

    private func pool() -> [Moment] {
        var out: [Moment] = []
        var n = 0
        func add(_ area: Area, _ topic: String, channels: Int, per: Int) {
            for c in 0..<channels { for _ in 0..<per { n += 1; out.append(moment("m\(n)", area, topic: topic, channel: "\(area.rawValue)-\(topic)-\(c)")) } }
        }
        add(.brain, "eyes", channels: 4, per: 30); add(.brain, "ai", channels: 5, per: 30)
        add(.body, "strength", channels: 4, per: 30); add(.body, "sleep", channels: 2, per: 30)
        add(.beat, "islam", channels: 5, per: 30)
        return out
    }

    private func queue(_ pool: [Moment], state: AppState, firstOfDay: Bool, blocks: Int) -> [[Moment]] {
        var c = Mix.Cursor(firstOfDay: firstOfDay)
        var out: [[Moment]] = []
        for _ in 0..<blocks {
            guard let b = Mix.nextBlock(pool: pool, state: state, cursor: &c) else { break }
            out.append(b)
        }
        return out
    }

    func testBlocksOfThreeFromOneArea() {
        let blocks = queue(pool(), state: AppState(), firstOfDay: true, blocks: 100)
        XCTAssertEqual(blocks.count, 100)
        for b in blocks {
            XCTAssertEqual(b.count, 3)
            XCTAssertEqual(Set(b.map(\.area)).count, 1)
        }
    }

    func testSharesWithinFivePercent() {
        let flat = queue(pool(), state: AppState(), firstOfDay: false, blocks: 100).flatMap { $0 }
        XCTAssertEqual(flat.count, 300)
        for a in Area.allCases {
            let share = Double(flat.filter { $0.area == a }.count) / Double(flat.count)
            XCTAssertLessThanOrEqual(abs(share - 1.0 / 3), 0.05, "\(a)")
        }
    }

    func testDayStartsWithBeat() {
        XCTAssertEqual(queue(pool(), state: AppState(), firstOfDay: true, blocks: 1)[0][0].area, .beat)
    }

    func testNoRepeatsAndSeenNeverReturn() {
        let p = pool()
        let flat = queue(p, state: AppState(), firstOfDay: false, blocks: 50).flatMap { $0 }
        XCTAssertEqual(Set(flat.map(\.id)).count, flat.count)
        var s = AppState()
        for m in flat.prefix(100) { s.seen[m.id] = Date() }
        let again = queue(p, state: s, firstOfDay: false, blocks: 80).flatMap { $0 }
        XCTAssertFalse(again.contains { s.seen[$0.id] != nil })
        XCTAssertEqual(Set(again.map(\.id)).count, again.count)
    }

    func testMutedChannelNeverAppears() {
        var s = AppState()
        s.muted["beat-islam-0"] = "beat-islam-0"
        s.muted["brain-ai-1"] = "brain-ai-1"
        let flat = queue(pool(), state: s, firstOfDay: true, blocks: 140).flatMap { $0 }
        XCTAssertGreaterThan(flat.count, 300)
        XCTAssertFalse(flat.contains { s.muted[$0.channel] != nil })
    }

    func testWeightsStayWithinLimits() {
        var w = Weights()
        let m = moment("x", .body, topic: "strength", channel: "c")
        for _ in 0..<40 { w = Mix.applySignal(w, m, Mix.Signal.more) }
        XCTAssertEqual(w.channel["c"], 3)
        for _ in 0..<80 { w = Mix.applySignal(w, m, Mix.Signal.negative) }
        XCTAssertEqual(w.channel["c"], 0.2)
    }

    func testEveryAreaKeepsTenPercent() {
        var w = Weights()
        w.area["beat"] = 0.2
        w.area["brain"] = 3
        let shares = Mix.effectiveShares(AppState().areaShares, w, areas: Area.allCases)
        XCTAssertGreaterThanOrEqual(shares[.beat]!, 0.1 - 1e-9)
        XCTAssertEqual(shares.values.reduce(0, +), 1, accuracy: 1e-9)
    }

    func testLeaveSignal() {
        XCTAssertEqual(Mix.leaveSignal(watched: 2, duration: 60), Mix.Signal.skip)
        XCTAssertEqual(Mix.leaveSignal(watched: 10, duration: 60), Mix.Signal.early)
        XCTAssertNil(Mix.leaveSignal(watched: 30, duration: 60))
        XCTAssertEqual(Mix.leaveSignal(watched: 50, duration: 60), Mix.Signal.mostly)
    }
}

final class VaultTests: XCTestCase {
    private func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Same envelope as build-enc.ts: {iv, ct} base64url, tag appended to ct.
    private func seal(_ json: String, key: Data) throws -> Data {
        let box = try AES.GCM.seal(Data(json.utf8), using: SymmetricKey(data: key))
        let env = ["iv": b64url(Data(box.nonce)), "ct": b64url(box.ciphertext + box.tag)]
        return try JSONSerialization.data(withJSONObject: env)
    }

    func testDecryptRoundTrip() throws {
        let key = Data((0..<32).map { UInt8($0) })
        let json = #"{"updatedAt":"2026-10-23T00:00:00Z","moments":[{"id":"a:1","videoId":"aaaaaaaaaaa","start":1,"end":31,"channel":"C (Dr. X)","area":"brain","topic":"eyes","hook":"H","cues":[[0,"first"],[2.5,"second"]]}]}"#
        let pool = try Vault.decrypt(try seal(json, key: key), key: key)
        XCTAssertEqual(pool.moments.count, 1)
        let m = try XCTUnwrap(pool.moments.first)
        XCTAssertEqual(m.speakerLine, "C · Dr. X")
        XCTAssertTrue(m.isYouTube)
        XCTAssertEqual(m.caption(at: 1), "first")
        XCTAssertEqual(m.caption(at: 2.6), "second")
        XCTAssertEqual(m.cues?.count, 2)
    }

    func testWrongKeyIsReported() throws {
        let key = Data(repeating: 1, count: 32)
        let sealed = try seal(#"{"moments":[]}"#, key: key)
        XCTAssertThrowsError(try Vault.decrypt(sealed, key: Data(repeating: 2, count: 32))) { e in
            XCTAssertEqual(e as? Vault.VaultError, .wrongKey)
        }
    }

    func testKeyFromLink() {
        let raw = Data((0..<32).map { UInt8(255 - $0) })
        let link = "https://amrsaad.github.io/core/#k=\(b64url(raw))"
        XCTAssertEqual(Vault.key(fromLink: "  \(link)\n"), raw)
        XCTAssertNil(Vault.key(fromLink: "https://amrsaad.github.io/core/#k=short"))
        XCTAssertNil(Vault.key(fromLink: "no key here"))
    }
}

final class StoreTests: XCTestCase {
    func testDayAndWeekKeys() {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        let thursday = c.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 12))!
        XCTAssertEqual(Day.key(thursday), "2026-10-22")
        XCTAssertEqual(Day.weekKey(thursday), "2026-10-19")
    }

    func testStateRoundTrip() throws {
        var s = AppState()
        s.seen["a"] = Date(timeIntervalSince1970: 1_700_000_000)
        s.weights.topic["eyes"] = 1.3
        s.log.append(LogEntry(id: "a", day: "2026-10-23", ended: true, watched: 42, feedback: "more"))
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        let back = try dec.decode(AppState.self, from: try enc.encode(s))
        XCTAssertEqual(back, s)
    }
}

/// Vertrag zwischen Pool und App, gleiche Fälle wie tests/moments-contract.test.ts im Web.
final class PoolContractTests: XCTestCase {
    private let excerpt = "Sentence one of the checked excerpt.\nSentence two of the checked excerpt."

    private func m(_ id: String, videoId: String = "dQw4w9WgXcQ", start: Double = 10, end: Double = 70, hls: String? = nil, audio: Bool? = nil, excerpt: String? = nil, form: String? = nil, hook: String = "Hook", recall: RecallQuestion? = nil) -> Moment {
        Moment(id: id, videoId: videoId, start: start, end: end, channel: "Kanal", videoTitle: nil, area: .brain, topic: "t",
               hook: hook, forYou: nil, kind: nil, top: nil, hls: hls, thumb: nil, url: nil, audio: audio, cues: nil, excerpt: excerpt, form: form, recall: recall)
    }

    func testYouTubeIDs() {
        XCTAssertTrue(PoolContract.isYouTubeID("dQw4w9WgXcQ"))
        for bad in ["", "short", "dQw4w9WgXcQ1", "dQw4w9 gXcQ", "dQw4w9WgXc!", "pod-abcdefg", "txt-abcdefg"] {
            XCTAssertFalse(PoolContract.isYouTubeID(bad), bad)
        }
    }

    func testValidCases() {
        XCTAssertNil(PoolContract.violation(m("v")))
        XCTAssertNil(PoolContract.violation(m("v", videoId: "ted-talk-1", hls: "https://x.test/v.m3u8")))
        XCTAssertNil(PoolContract.violation(m("a", videoId: "pod-abcdef12", hls: "https://x.test/a.m3u8", form: "audio")))
        XCTAssertNil(PoolContract.violation(m("a2", videoId: "pod-abcdef12", hls: "https://x.test/a.m3u8", audio: true)))
        XCTAssertNil(PoolContract.violation(m("t", videoId: "txt-abcdef12", excerpt: excerpt, form: "text")))
        // Text braucht weder Zeiten noch Stream
        XCTAssertNil(PoolContract.violation(m("t2", start: 0, end: 0, excerpt: excerpt, form: "text")))
    }

    func testTextWithoutExcerpt() {
        XCTAssertEqual(PoolContract.violation(m("t", videoId: "txt-abcdef12", form: "text")), "text ohne excerpt")
        XCTAssertEqual(PoolContract.violation(m("t", excerpt: "  \n ", form: "text")), "text ohne excerpt")
    }

    func testAudioWithoutHLS() {
        XCTAssertEqual(PoolContract.violation(m("a", videoId: "pod-abcdef12", form: "audio")), "audio ohne hls")
        XCTAssertEqual(PoolContract.violation(m("a", audio: true)), "audio ohne hls")
        XCTAssertEqual(PoolContract.violation(m("a", hls: "", form: "audio")), "hls leer")
    }

    func testVideoWithPodOrInvalidID() {
        let why = "video ohne hls und ohne YouTube-ID"
        XCTAssertEqual(PoolContract.violation(m("v", videoId: "pod-abcdefg")), why)
        XCTAssertEqual(PoolContract.violation(m("v", videoId: "abc")), why)
        XCTAssertEqual(PoolContract.violation(m("v", videoId: "txt-abcdefg")), why)
    }

    func testTimesAndRequiredFields() {
        XCTAssertEqual(PoolContract.violation(m("v", end: 10)), "start oder end ungültig")
        XCTAssertEqual(PoolContract.violation(m("v", end: .nan)), "start oder end ungültig")
        XCTAssertEqual(PoolContract.violation(m("", hook: "x")), "id fehlt")
        XCTAssertEqual(PoolContract.violation(m("v", hook: "  ")), "hook fehlt")
        XCTAssertEqual(PoolContract.violation(m("v", form: "reel")), "form ungültig")
    }

    func testValidateSkipsCountsAndKeepsOrder() {
        let list = [m("a"), m("b", videoId: "txt-abcdef12", form: "text"), m("c", videoId: "pod-abcdef12", hls: "https://x.test/a.m3u8", form: "audio"),
                    m("d", videoId: "pod-abcdef12", form: "audio"), m("e", videoId: "pod-abcdefg"), m("a", hook: "doppelt")]
        let r = PoolContract.validate(list)
        XCTAssertEqual(r.moments.map(\.id), ["a", "c"])
        XCTAssertEqual(r.skipped, 4)
        XCTAssertEqual(r.reasons["text ohne excerpt"], 1)
        XCTAssertEqual(r.reasons["audio ohne hls"], 1)
        XCTAssertEqual(r.reasons["video ohne hls und ohne YouTube-ID"], 1)
        XCTAssertEqual(r.reasons["doppelte id"], 1)
    }

    func testBadRecallIsDroppedMomentStays() {
        let broken = RecallQuestion(question: "q", options: ["a", "b"], correct: 0, why: "w")
        let outOfRange = RecallQuestion(question: "q", options: ["a", "b", "c"], correct: 3, why: "w")
        let fine = RecallQuestion(question: "q", options: ["a", "b", "c"], correct: 2, why: "w")
        let r = PoolContract.validate([m("a", recall: broken), m("b", recall: outOfRange), m("c", recall: fine)])
        XCTAssertEqual(r.skipped, 0)
        XCTAssertNil(r.moments[0].recall)
        XCTAssertNil(r.moments[1].recall)
        XCTAssertEqual(r.moments[2].recall, fine)
    }

    /// Ein einzelner nicht lesbarer Eintrag (falsche area, Zahl statt Objekt, kaputte Untertitel) kippt das Laden des Pools nicht
    func testPoolDecodesPastUnreadableEntries() throws {
        let json = """
        {"updatedAt":"2026-10-27T00:00:00Z","moments":[
          {"id":"ok1","videoId":"dQw4w9WgXcQ","start":1,"end":41,"channel":"K","area":"brain","topic":"t","hook":"H"},
          {"id":"badarea","videoId":"dQw4w9WgXcQ","start":1,"end":41,"channel":"K","area":"mind","topic":"t","hook":"H"},
          7,
          {"id":"badcues","videoId":"dQw4w9WgXcQ","start":1,"end":41,"channel":"K","area":"body","topic":"t","hook":"H","cues":"nein"},
          {"id":"pod1","videoId":"pod-abcdef12","start":1,"end":41,"channel":"K","area":"body","topic":"t","hook":"H","form":"audio"},
          {"id":"txt1","videoId":"txt-abcdef12","start":1,"end":41,"channel":"K","area":"beat","topic":"t","hook":"H","form":"text"},
          {"id":"ok2","videoId":"txt-abcdef12","start":1,"end":41,"channel":"K","area":"beat","topic":"t","hook":"H","form":"text","excerpt":"Ein Text."}
        ]}
        """
        let pool = try JSONDecoder().decode(Pool.self, from: Data(json.utf8))
        XCTAssertEqual(pool.moments.map(\.id), ["ok1", "ok2"])
        XCTAssertEqual(pool.skipped, 5)
    }
}
