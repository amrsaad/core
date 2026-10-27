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
    func testActions() {
        XCTAssertEqual(Actions.heartSeconds, 0.4)
        XCTAssertEqual(Actions.confirmSeconds, 0.15)
        XCTAssertEqual(Actions.targetPt, 48)
        // Toast nur bei Mute und Wrong
        for k in [Actions.Kind.more, .save, .source, .known, .weak, .captions] { XCTAssertFalse(Actions.toast(k)) }
        XCTAssertTrue(Actions.toast(.mute) && Actions.toast(.wrong))
        // Doppeltipp setzt nur, der Knopf schaltet um
        XCTAssertTrue(Actions.nextLiked(false, double: true))
        XCTAssertTrue(Actions.nextLiked(true, double: true))
        XCTAssertTrue(Actions.nextLiked(false, double: false))
        XCTAssertFalse(Actions.nextLiked(true, double: false))
        // Reaktionszeit
        XCTAssertEqual(Actions.stats([]).n, 0)
        var l: [Actions.Tap] = []
        for ms in [20, 30, 40, 50, 150] { l = Actions.add(l, .init(ms: ms, at: Date(timeIntervalSince1970: 0))) }
        let x = Actions.stats(l)
        XCTAssertEqual(x, Actions.Stats(n: 5, median: 40, p90: 150, underTarget: 0.8))
        for i in 0..<(Actions.maxTaps + 10) { l = Actions.add(l, .init(ms: i, at: Date(timeIntervalSince1970: 0))) }
        XCTAssertEqual(l.count, Actions.maxTaps)
        XCTAssertEqual(Actions.line(Actions.stats([])), "no taps measured yet")
    }

    func testFormFilter() {
        // ohne Feld form: audio true heißt audio, sonst video
        XCTAssertEqual(FormFilter.of(form: nil, audio: false), .video)
        XCTAssertEqual(FormFilter.of(form: nil, audio: true), .audio)
        // das Feld schlägt audio
        XCTAssertEqual(FormFilter.of(form: "video", audio: true), .video)
        XCTAssertEqual(FormFilter.of(form: "audio", audio: false), .audio)
        XCTAssertEqual(FormFilter.of(form: "text", audio: false), .text)
        XCTAssertEqual(FormFilter.of(form: "unknown", audio: true), .audio)
        // Text gibt es nur mit form text
        XCTAssertFalse(FormFilter.includes(form: nil, audio: false, .text))
        XCTAssertTrue(FormFilter.includes(form: "text", audio: false, .text))
        XCTAssertFalse(FormFilter.includes(form: "text", audio: false, .video))
        XCTAssertEqual(FormFilter.emptyLine(.video), "No video moments yet")
        XCTAssertEqual(FormFilter.emptyLine(.audio), "No audio moments yet")
        XCTAssertEqual(FormFilter.emptyLine(.text), "Text sources coming")
    }

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
        XCTAssertNil(Recall.pick(Recall.answer([:], id: "b", got: true, now: t), recent: [.init(id: "b", watched: 1)], now: t, available: all))
        let r0 = Recall.answer([:], id: "old", got: true, now: t.addingTimeInterval(-8 * day))
        XCTAssertEqual(Recall.pick(r0, recent: [.init(id: "new", watched: 1)], now: t, available: all), .init(id: "old", review: true))
        XCTAssertEqual(Recall.pick(r0, recent: [.init(id: "new", watched: 1)], now: t, available: { $0 != "old" }), .init(id: "new", review: false))

        // Abstände: Treffer 7 Tage, zweiter Treffer 21 Tage, dritter beendet
        var r = Recall.answer([:], id: "m", got: true, now: t)
        XCTAssertEqual(r["m"]?.due, t.addingTimeInterval(7 * day))
        r = Recall.answer(r, id: "m", got: true, now: t.addingTimeInterval(7 * day))
        XCTAssertEqual(r["m"]?.due, t.addingTimeInterval(28 * day))
        r = Recall.answer(r, id: "m", got: true, now: t.addingTimeInterval(28 * day))
        XCTAssertNil(r["m"]?.due)

        // Fehler: nach 2 Tagen, danach beginnt die Folge neu
        var miss = Recall.answer([:], id: "m", got: false, now: t)
        XCTAssertEqual(miss["m"]?.due, t.addingTimeInterval(2 * day))
        XCTAssertFalse(Recall.isKnown(miss, "m"))
        miss = Recall.answer(miss, id: "m", got: true, now: t.addingTimeInterval(2 * day))
        XCTAssertTrue(Recall.isKnown(miss, "m"))
        XCTAssertEqual(miss["m"]?.due, t.addingTimeInterval(9 * day))
        miss = Recall.answer(miss, id: "m", got: false, now: t.addingTimeInterval(9 * day))
        XCTAssertEqual(miss["m"]?.due, t.addingTimeInterval(11 * day))
        miss = Recall.answer(miss, id: "m", got: true, now: t.addingTimeInterval(11 * day))
        miss = Recall.answer(miss, id: "m", got: true, now: t.addingTimeInterval(18 * day))
        XCTAssertEqual(miss["m"]?.due, t.addingTimeInterval(39 * day))

        // Momente ohne recall bekommen keine Karte, der nächste Kandidat mit recall rückt nach
        let has: Set<String> = ["a", "c"]
        let r4: [Recall.Recent] = [.init(id: "a", watched: 1), .init(id: "b", watched: 1), .init(id: "c", watched: 0.2), .init(id: "d", watched: 0.9)]
        XCTAssertEqual(Recall.pick([:], recent: r4, now: t, available: { has.contains($0) }), .init(id: "a", review: false))
        XCTAssertNil(Recall.pick([:], recent: r4, now: t, available: { _ in false }))

        // Antwortreihenfolge: Permutation, alle 6 Reihenfolgen möglich
        struct Lcg: RandomNumberGenerator { var s: UInt64; mutating func next() -> UInt64 { s = s &* 6364136223846793005 &+ 1442695040888963407; return s } }
        var g = Lcg(s: 7)
        var seen = Set<[Int]>()
        for _ in 0..<300 {
            let o = Recall.shuffleOrder(3, using: &g)
            XCTAssertEqual(o.sorted(), [0, 1, 2])
            seen.insert(o)
        }
        XCTAssertEqual(seen.count, 6)
    }

    // Aufgabe 4
    func testHook() {
        XCTAssertEqual([1, 2, 3, 4, 7].map { Hook.step(linesAtNormal: $0) }, [0, 0, 0, 1, 1])
        XCTAssertEqual([0, 5, 65, 100, 760, 3723].map { Hook.atTime($0) }, ["0:00", "0:05", "1:05", "1:40", "12:40", "1:02:03"])
        XCTAssertEqual(Hook.atTime(-4), "0:00")
        XCTAssertTrue(Hook.closes(dy: 80, scrollTop: 0))
        XCTAssertFalse(Hook.closes(dy: 80, scrollTop: 120))
        XCTAssertFalse(Hook.closes(dy: 30, scrollTop: 0))
        XCTAssertFalse(Hook.closes(dy: -90, scrollTop: 0))
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
