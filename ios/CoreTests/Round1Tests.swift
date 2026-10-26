import XCTest
@testable import Core

/// Gleiche Prüfdaten wie die Web-Tests tests/moments-latency, -play, -captions, -today, -form, -recall, -review.test.ts
final class Round1Tests: XCTestCase {
    // Punkt 1
    func testLatency() {
        XCTAssertEqual(Latency.targetMs, 300)
        var l: [Latency.Sample] = []
        for i in 1...(Latency.maxSamples + 10) { l = Latency.add(l, .init(ms: i, buffered: true, at: Date())) }
        XCTAssertEqual(l.count, Latency.maxSamples)
        XCTAssertEqual(l.first?.ms, 11)
        let s: [Latency.Sample] = [100, 200, 250, 400].map { .init(ms: $0, buffered: true, at: Date()) } + [.init(ms: 900, buffered: false, at: Date())]
        XCTAssertEqual(Latency.stats(s, buffered: true), .init(n: 4, median: 200, p90: 400, underTarget: 0.75))
        XCTAssertEqual(Latency.stats(s, buffered: false), .init(n: 1, median: 900, p90: 900, underTarget: 0))
        XCTAssertEqual(Latency.stats([], buffered: true), .init(n: 0, median: nil, p90: nil, underTarget: nil))
        XCTAssertEqual(Latency.line("Preloaded", Latency.stats(s, buffered: true)), "Preloaded: median 200 ms, 90 % within 400 ms, 75 % under 300 ms (4 swipes)")
    }

    // Punkt 2
    func testSpeed() {
        XCTAssertEqual(Speed.standard, 1.5)
        XCTAssertEqual(Speed.options, [1, 1.5])
        XCTAssertEqual(Speed.hold, 2)
        XCTAssertEqual(Speed.clamp(2.5), 2)
        XCTAssertEqual(Speed.clamp(1.5), 1.5)
        XCTAssertEqual(Speed.of(1), 1)
        XCTAssertEqual(Speed.of(2), 1.5)
        XCTAssertEqual(Speed.of(nil), 1.5)
    }

    // Punkt 4
    func testCaptions() {
        let en = ["The macula is the center of the retina."]
        let ar = ["وما من قلب إلا وهو بين إصبعين"]
        XCTAssertFalse(Captions.defaultOn(texts: en, audio: false))
        XCTAssertTrue(Captions.defaultOn(texts: en, audio: true))
        XCTAssertTrue(Captions.defaultOn(texts: ar, audio: false))
        XCTAssertFalse(Captions.shown(.on, texts: [], audio: false))
        XCTAssertFalse(Captions.shown(.on, texts: [" "], audio: false))
        XCTAssertFalse(Captions.shown(.auto, texts: [], audio: true))
        XCTAssertTrue(Captions.shown(.on, texts: en, audio: false))
        XCTAssertFalse(Captions.shown(.off, texts: ar, audio: false))
        XCTAssertTrue(Captions.shown(nil, texts: ar, audio: false))
        XCTAssertTrue(Captions.isArabic("Gemischt: قال الإمام"))
        XCTAssertFalse(Captions.isArabic("Ali said the Prophet was recovering."))
    }

    // Punkt 6
    func testToday() {
        var d: [String: DayCount] = [:]
        for _ in 0..<200 { d = Today.countSeen(d, "2026-10-26") }
        XCTAssertEqual(d["2026-10-26"], DayCount(seen: 200, gotIt: 0))
        d = Today.countSeen(d, "2026-10-27")
        XCTAssertEqual(d["2026-10-27"]?.seen, 1)
        var many: [String: DayCount] = [:]
        for i in 0..<(Today.keep + 5) { many = Today.countSeen(many, String(format: "2026-%02d-%02d", 1 + i / 28, 1 + i % 28)) }
        XCTAssertEqual(many.count, Today.keep)
        XCTAssertEqual(Today.line(DayCount(seen: 14, gotIt: 3), withGotIt: true), "today 14 seen, 3 got it")
        XCTAssertEqual(Today.line(nil, withGotIt: false), "today 0 seen")
        XCTAssertEqual(Today.countGotIt([:], "x")["x"], DayCount(seen: 0, gotIt: 1))
    }

    // Punkt 3
    func testForm() {
        XCTAssertEqual(FeedForm.allCases, [.video, .audio, .text])
        XCTAssertEqual(FormText.text(excerpt: " Satz eins.\nSatz zwei. ", cues: ["x"]), "Satz eins.\nSatz zwei.")
        XCTAssertEqual(FormText.text(excerpt: nil, cues: ["Eins,", " zwei  drei."]), "Eins, zwei drei.")
        XCTAssertEqual(FormText.text(excerpt: nil, cues: []), "")
        XCTAssertFalse(FormText.endReached(offset: 0, visible: 600, content: 1800))
        XCTAssertTrue(FormText.endReached(offset: 1200, visible: 600, content: 1800))
        XCTAssertTrue(FormText.endReached(offset: 0, visible: 600, content: 500))
    }

    // Punkt 5
    func testRecall() {
        let t = Date(timeIntervalSince1970: 1_800_000_000)
        let day = Recall.day
        XCTAssertEqual([1, 2, 3, 4, 5, 8, 12].map(Recall.cardDue), [false, false, false, true, false, true, true])
        XCTAssertFalse(Recall.cardDue(0))
        let all: (String) -> Bool = { _ in true }
        let recent: [Recall.Recent] = [.init(id: "a", watched: 1), .init(id: "b", watched: 0.9), .init(id: "c", watched: 0.5), .init(id: "d", watched: 0.79)]
        XCTAssertEqual(Recall.pick([:], recent: recent, now: t, available: all), .init(id: "b", review: false))
        let old: [Recall.Recent] = [.init(id: "old", watched: 1)] + ["w", "x", "y", "z"].map { .init(id: $0, watched: 0.2) }
        XCTAssertNil(Recall.pick([:], recent: old, now: t, available: all))
        XCTAssertNil(Recall.pick(Recall.answer([:], id: "b", got: true, now: t, saved: false), recent: [.init(id: "b", watched: 1)], now: t, available: all))
        let r0 = Recall.answer([:], id: "old", got: true, now: t.addingTimeInterval(-8 * day), saved: false)
        XCTAssertEqual(Recall.pick(r0, recent: [.init(id: "new", watched: 1)], now: t, available: all), .init(id: "old", review: true))
        XCTAssertEqual(Recall.pick(r0, recent: [.init(id: "new", watched: 1)], now: t, available: { $0 != "old" }), .init(id: "new", review: false))

        var r = Recall.answer([:], id: "m", got: true, now: t, saved: true)
        XCTAssertEqual(r["m"]?.due, t.addingTimeInterval(7 * day))
        r = Recall.answer(r, id: "m", got: true, now: t.addingTimeInterval(7 * day), saved: true)
        XCTAssertEqual(r["m"]?.due, t.addingTimeInterval(28 * day))
        r = Recall.answer(r, id: "m", got: true, now: t.addingTimeInterval(28 * day), saved: true)
        XCTAssertNil(r["m"]?.due)

        var n = Recall.answer([:], id: "m", got: true, now: t, saved: false)
        n = Recall.answer(n, id: "m", got: true, now: t.addingTimeInterval(7 * day), saved: false)
        XCTAssertNil(n["m"]?.due)

        var miss = Recall.answer([:], id: "m", got: false, now: t, saved: false)
        XCTAssertEqual(miss["m"]?.due, t.addingTimeInterval(7 * day))
        XCTAssertFalse(Recall.isKnown(miss, "m"))
        miss = Recall.answer(miss, id: "m", got: true, now: t.addingTimeInterval(7 * day), saved: true)
        XCTAssertTrue(Recall.isKnown(miss, "m"))
        XCTAssertEqual(miss["m"]?.due, t.addingTimeInterval(28 * day))
    }

    // Punkt 7
    func testWeekReview() {
        XCTAssertTrue(WeekReview.planComplete(when: "I finish the OCT clinic", will: "explain it"))
        XCTAssertFalse(WeekReview.planComplete(when: "I finish the OCT clinic", will: ""))
        XCTAssertFalse(WeekReview.planComplete(when: " a ", will: "xyz"))
        let dc = ["2026-10-25": DayCount(seen: 10, gotIt: 6), "2026-10-22": DayCount(seen: 4, gotIt: 3), "2026-10-10": DayCount(seen: 99, gotIt: 99)]
        let days = (19...25).map { "2026-10-\($0)" }
        let t = WeekReview.task(dayCount: dc, days: days, applied: 1)
        XCTAssertEqual(t.seen, 14)
        XCTAssertEqual(t.gotIt, 9)
        XCTAssertEqual(WeekReview.line(seen: 14, gotIt: 9, applied: 3), "14 seen, 9 got it, 3 applied")
    }

    // Schlüsselsicherung
    func testKeyBackup() {
        let k = Data(repeating: 7, count: 32), other = Data(repeating: 9, count: 32)
        XCTAssertEqual(KeyBackup.plan(keychain: k, file: k), .init(key: k, writeKeychain: false, writeFile: false))
        XCTAssertEqual(KeyBackup.plan(keychain: nil, file: k), .init(key: k, writeKeychain: true, writeFile: false))
        XCTAssertEqual(KeyBackup.plan(keychain: k, file: nil), .init(key: k, writeKeychain: false, writeFile: true))
        XCTAssertEqual(KeyBackup.plan(keychain: k, file: other), .init(key: k, writeKeychain: false, writeFile: true))
        XCTAssertEqual(KeyBackup.plan(keychain: nil, file: Data([1, 2])), .init(key: nil, writeKeychain: false, writeFile: false))
        let raw = Data((0..<32).map { UInt8(255 - $0) })
        let link = KeyBackup.link(raw)
        XCTAssertTrue(link.hasPrefix("https://amrsaad.github.io/core/#k="))
        XCTAssertEqual(link.count, "https://amrsaad.github.io/core/#k=".count + 43)
    }
}
