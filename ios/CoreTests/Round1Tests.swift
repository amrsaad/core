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
        for k in [Actions.Kind.more, .save, .source, .known] { XCTAssertFalse(Actions.toast(k)) }
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

        // Core Digest (recallBoost): Fehler 1 Tag, Treffer 4, zweiter Treffer in Folge 14, dritter beendet
        var b = Recall.answer([:], id: "b", got: true, now: t, boost: true)
        XCTAssertEqual(b["b"]?.due, t.addingTimeInterval(4 * day))
        b = Recall.answer(b, id: "b", got: true, now: t.addingTimeInterval(4 * day), boost: true)
        XCTAssertEqual(b["b"]?.due, t.addingTimeInterval(18 * day))
        b = Recall.answer(b, id: "b", got: true, now: t.addingTimeInterval(18 * day), boost: true)
        XCTAssertNil(b["b"]?.due)
        let bm = Recall.answer([:], id: "b", got: false, now: t, boost: true)
        XCTAssertEqual(bm["b"]?.due, t.addingTimeInterval(1 * day))
        XCTAssertEqual(Recall.answer([:], id: "b", got: false, now: t)["b"]?.due, t.addingTimeInterval(2 * day), "ohne Boost bleibt es bei 2 Tagen")

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

    // Wischgeste, gleiche Prüfdaten wie tests/moments-actions.test.ts
    func testSwipe() {
        XCTAssertEqual(Actions.swipePt, 60)
        XCTAssertEqual(Actions.swipe(dx: -61, dy: 0), .note)
        XCTAssertNil(Actions.swipe(dx: -60, dy: 0))
        XCTAssertEqual(Actions.swipe(dx: -120, dy: 40), .note)
        XCTAssertEqual(Actions.swipe(dx: -70, dy: -80), .next)
        XCTAssertEqual(Actions.swipe(dx: 0, dy: -61), .next)
        XCTAssertEqual(Actions.swipe(dx: 10, dy: 61), .prev)
        XCTAssertNil(Actions.swipe(dx: 0, dy: -60))
        XCTAssertNil(Actions.swipe(dx: 120, dy: 10))
        XCTAssertEqual(Actions.swipe(dx: -80, dy: -80), .next)
    }

    // Rückmeldung (Auftrag 27.10.2026), gleiche Prüfdaten wie tests/moments-note.test.ts
    func testNote() {
        func ctx(_ id: String, _ hook: String) -> Note.Context { .init(id: id, hook: hook, tab: "Video", commit: "4ed41a7") }
        let a = ctx("abc123:100", "Don't compare body fat across devices (100% rule)!")
        let b = ctx("def456:20", "Sleep | not coffee")
        XCTAssertEqual(Note.chips, ["Known", "Not for me", "Wrong", "Boring", "Bad cut", "Great", "Mute speaker"])
        XCTAssertEqual(Note.effect("Known"), .known)
        XCTAssertEqual(Note.effect("Wrong"), .wrong)
        XCTAssertEqual(Note.effect("Mute speaker"), .mute)
        XCTAssertEqual(Note.effect("Not for me"), .notForMe)
        XCTAssertEqual(Note.effect("Boring"), .weak)
        for c in ["Bad cut", "Great"] { XCTAssertNil(Note.effect(c)) }
        // Notiz aus Chip oder Text
        XCTAssertNil(Note.makeEntry(a, chips: [], text: "  ", at: 1))
        let e = Note.makeEntry(a, chips: ["Great"], text: "  Clear.  ", at: 1_700_000_000_000)
        XCTAssertEqual(e, Note.Entry(key: "abc123:100#1700000000000", id: "abc123:100", hook: a.hook, chips: ["Great"], text: "Clear.",
                                     tab: "Video", commit: "4ed41a7", at: 1_700_000_000_000, sent: nil))
        XCTAssertEqual(Note.makeEntry(a, chips: [], text: "Late cut", at: 1)?.chips, [])
        XCTAssertEqual(Note.makeEntry(a, chips: [], text: String(repeating: "x", count: Note.textMax + 50), at: 1)?.text.count, Note.textMax)
        // Zeile "N notes, send?" einmal pro Tag
        XCTAssertEqual(Note.promptLine(1), "1 note, send?")
        XCTAssertEqual(Note.promptLine(3), "3 notes, send?")
        XCTAssertTrue(Note.shouldPrompt(2, last: nil, today: "2026-10-28"))
        XCTAssertTrue(Note.shouldPrompt(2, last: "2026-10-27", today: "2026-10-28"))
        XCTAssertFalse(Note.shouldPrompt(2, last: "2026-10-28", today: "2026-10-28"))
        XCTAssertFalse(Note.shouldPrompt(0, last: nil, today: "2026-10-28"))
        XCTAssertTrue(Note.firstOpenOfDay(last: nil, today: "2026-10-28"))
        XCTAssertFalse(Note.firstOpenOfDay(last: "2026-10-28", today: "2026-10-28"))
        // Zeilen je Moment
        let list = [
            Note.makeEntry(a, chips: ["Known"], text: "", at: 1)!,
            Note.makeEntry(b, chips: [], text: "Cut is\ntwo seconds late", at: 2)!,
            Note.makeEntry(a, chips: ["Bad cut"], text: "Starts mid-sentence", at: 3)!,
        ]
        let r = Note.rows(list)
        XCTAssertEqual(r.count, 2)
        XCTAssertEqual(r[0].chips, ["Known", "Bad cut"])
        XCTAssertEqual(r[0].text, "Starts mid-sentence")
        XCTAssertEqual(r[0].keys, ["abc123:100#1", "abc123:100#3"])
        XCTAssertEqual(r[1].chips, [])
        // Ein einziges Issue
        let built = Note.buildIssue(list, day: "2026-10-28")
        XCTAssertEqual(built?.rows, 2)
        XCTAssertEqual(built?.keys, ["abc123:100#1", "abc123:100#3", "def456:20#2"])
        XCTAssertEqual(built?.url, "https://github.com/amrsaad/core-content/issues/new?title=Core%20feedback%202026-10-28%2C%202%20moments&body=%7C%20Moment%20%7C%20Hook%20%7C%20Chips%20%7C%20Text%20%7C%20Tab%20%7C%20App%20%7C%0A%7C---%7C---%7C---%7C---%7C---%7C---%7C%0A%7C%20abc123%3A100%20%7C%20Don%27t%20compare%20body%20fat%20across%20devices%20%28100%25%20rule%29%21%20%7C%20Known%2C%20Bad%20cut%20%7C%20Starts%20mid-sentence%20%7C%20Video%20%7C%204ed41a7%20%7C%0A%7C%20def456%3A20%20%7C%20Sleep%20%2F%20not%20coffee%20%7C%20-%20%7C%20Cut%20is%20two%20seconds%20late%20%7C%20Video%20%7C%204ed41a7%20%7C&labels=feedback")
        XCTAssertNil(Note.buildIssue([], day: "2026-10-28"))
        XCTAssertTrue(Note.buildIssue([list[0]], day: "2026-10-28")?.url.contains("2026-10-28%2C%201%20moment&") ?? false)
        XCTAssertEqual(Note.enc("a b&c=d+e'(f)!*"), "a%20b%26c%3Dd%2Be%27%28f%29%21%2A")
        // Zu viele Notizen: Adresse bleibt unter dem Limit, der Rest bleibt ungesendet
        let many = (0..<60).map { i in
            Note.makeEntry(ctx("vid\(i):0", String(repeating: "Hook number \(i) ", count: 4)), chips: ["Boring"], text: String(repeating: "y", count: 300), at: i + 10)!
        }
        let big = Note.buildIssue(many, day: "2026-10-28")!
        XCTAssertLessThanOrEqual(big.url.count, Note.urlMax)
        XCTAssertGreaterThan(big.rows, 5)
        XCTAssertLessThan(big.rows, 60)
        XCTAssertEqual(big.keys, many.prefix(big.rows).map(\.key))
        let left = Note.unsent(Note.markSent(many, keys: big.keys, at: 99))
        XCTAssertEqual(left.count, 60 - big.rows)
        XCTAssertEqual(left.first?.key, many[big.rows].key)
        // Gesendet markieren, nach 30 Tagen fallen alte heraus
        let day = 86_400_000
        var old = list[0]; old.sent = 1_000_000
        let out = Note.markSent([old, list[1]], keys: [list[1].key], at: 1_000_000 + 31 * day)
        XCTAssertEqual(out.map(\.key), [list[1].key])
        XCTAssertEqual(out.first?.sent, 1_000_000 + 31 * day)
        XCTAssertTrue(Note.unsent(out).isEmpty)
        XCTAssertTrue(Note.unsent(nil).isEmpty)
    }

    // Aufgabe 6, gleiche Prüfdaten wie tests/moments-source.test.ts
    func testSourceLine() {
        let res = "Alle Rechte vorbehalten, frei lesbar. Private Nutzung, Passagen mit Quellenangabe"
        XCTAssertEqual(SourceLine.line(author: "Jane Roe", channel: "Europe PMC", ref: "PMC123", license: "CC BY 4.0", sourceUrl: "https://example.org/a"),
                       .init(prefix: "", text: "Jane Roe, Europe PMC, PMC123, CC BY 4.0", url: URL(string: "https://example.org/a")))
        XCTAssertEqual(SourceLine.line(author: "Jordan Feigenbaum", channel: "Barbell Medicine", ref: nil, license: res, sourceUrl: "https://www.barbellmedicine.com/x/"),
                       .init(prefix: "Quoted from ", text: "Jordan Feigenbaum, Barbell Medicine, All rights reserved", url: URL(string: "https://www.barbellmedicine.com/x/")))
        XCTAssertTrue(SourceLine.isReserved("All rights reserved"))
        XCTAssertFalse(SourceLine.isReserved("CC BY 4.0"))
        XCTAssertFalse(SourceLine.isReserved(nil))
        XCTAssertEqual(SourceLine.line(author: nil, channel: "Quran.com", ref: "Quran 94:5", license: "CC BY 4.0", sourceUrl: nil)?.text, "Quran.com, Quran 94:5, CC BY 4.0")
        XCTAssertEqual(SourceLine.line(author: "Quran.com", channel: "Quran.com", ref: nil, license: "CC BY 4.0", sourceUrl: nil)?.text, "Quran.com, CC BY 4.0")
        XCTAssertNil(SourceLine.line(author: "A", channel: "", ref: nil, license: "CC BY 4.0", sourceUrl: nil)?.url)
        XCTAssertNil(SourceLine.line(author: "A", channel: "", ref: nil, license: "CC BY 4.0", sourceUrl: "javascript:alert(1)")?.url)
        XCTAssertNil(SourceLine.line(author: nil, channel: "", ref: nil, license: nil, sourceUrl: nil))
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
