import XCTest
@testable import Core

/// Entscheidung 13 (core-content/docs/fundament.md): Hintergrund-Wiedergabe. Dieselben Regeln wie tests/background-play.test.ts im Web.
final class BackgroundTests: XCTestCase {
    private func moment(_ id: String, area: Area = .brain, hls: String? = "https://example.com/a.m3u8") -> Moment {
        Moment(id: id, videoId: id, start: 0, end: 60, channel: "Channel (Name)", videoTitle: nil, area: area, topic: "eyes",
               hook: "Hook \(id)", forYou: nil, kind: "story", top: false, hls: hls, thumb: nil, url: nil, audio: nil, cues: nil)
    }

    // MARK: Hintergrund verlassen

    func testOwnStreamsKeepTheSoundYouTubeAndTextStop() {
        for form in [FeedForm.audio, .video] {
            XCTAssertEqual(BackgroundPolicy.onLeave(form: form, isYouTube: false), .keepSound, "\(form)")
        }
        XCTAssertEqual(BackgroundPolicy.onLeave(form: .video, isYouTube: true), .pause)
        XCTAssertEqual(BackgroundPolicy.onLeave(form: .audio, isYouTube: true), .pause)
        XCTAssertEqual(BackgroundPolicy.onLeave(form: .text, isYouTube: false), .pause)
    }

    // MARK: Ende eines Moments

    func testAudioAdvancesInTheBackgroundVideoStops() {
        XCTAssertEqual(BackgroundPolicy.atEnd(form: .audio, inBackground: true), .advance)
        XCTAssertEqual(BackgroundPolicy.atEnd(form: .video, inBackground: true), .stop)
        XCTAssertEqual(BackgroundPolicy.atEnd(form: .text, inBackground: true), .stop)
    }

    func testForegroundKeepsAdvancing() {
        for form in FeedForm.allCases {
            XCTAssertEqual(BackgroundPolicy.atEnd(form: form, inBackground: false), .advance, "\(form)")
        }
    }

    // MARK: Gesehen nur bei ended

    func testSeenCountsAtStartOnlyInTheForeground() {
        XCTAssertTrue(BackgroundPolicy.countsSeenAtStart(inBackground: false))
        XCTAssertFalse(BackgroundPolicy.countsSeenAtStart(inBackground: true))
    }

    func testEndCountsOnceEvenAfterReturn() {
        var ledger = EndLedger()
        XCTAssertTrue(ledger.first("a"))
        XCTAssertFalse(ledger.first("a"), "second end of the same moment must not count")
        XCTAssertTrue(ledger.first("b"))
    }

    /// Ablauf mit denselben Regeln wie FeedView: Start im Hintergrund zählt nicht, ended zählt einmal, die Rückkehr zählt nicht doppelt.
    func testBackgroundRunCountsEachMomentOnce() {
        var ledger = EndLedger()
        var seen = Set<String>()
        var endedSignals = 0
        func start(_ id: String, background: Bool) {
            if BackgroundPolicy.countsSeenAtStart(inBackground: background) { seen.insert(id) }
        }
        func end(_ id: String) {
            if ledger.first(id) { endedSignals += 1; seen.insert(id) }
        }

        start("a", background: false)   // im Vordergrund gestartet, dann Sperre
        start("b", background: true)    // Auto-Weiter im Hintergrund
        XCTAssertEqual(seen, ["a"])
        end("a")
        end("b")
        XCTAssertEqual(seen, ["a", "b"])
        XCTAssertEqual(endedSignals, 2)

        // Rückkehr: sceneChanged markiert den laufenden Moment erneut als gesehen, ein zweites ended zählt nicht
        seen.insert("b")
        end("b")
        XCTAssertEqual(seen, ["a", "b"])
        XCTAssertEqual(endedSignals, 2)
    }

    // MARK: Auto-Weiter = Wisch

    func testAutoAdvancePicksTheSwipeSuccessor() {
        let queue = ["a", "b", "c"].map { moment($0) }
        XCTAssertEqual(QueueStep.next(in: queue, after: "a")?.id, "b")
        XCTAssertEqual(QueueStep.next(in: queue, after: "b")?.id, "c")
        XCTAssertNil(QueueStep.next(in: queue, after: "c"), "end of queue: stop cleanly")
        XCTAssertNil(QueueStep.next(in: queue, after: "zzz"))
        XCTAssertNil(QueueStep.next(in: queue, after: nil))
    }

    func testPreviousIsTheSwipeBack() {
        let queue = ["a", "b", "c"].map { moment($0) }
        XCTAssertEqual(QueueStep.previous(in: queue, before: "c")?.id, "b")
        XCTAssertNil(QueueStep.previous(in: queue, before: "a"))
    }

    /// Der Nachfolger kommt aus der Warteschlange der Mischung, kein eigener Algorithmus: derselbe Cursor liefert dieselbe Folge.
    func testNextComesFromTheMix() {
        var pool: [Moment] = []
        for i in 0..<30 { pool.append(moment("m\(i)", area: Area.allCases[i % 3])) }
        var c = Mix.Cursor(firstOfDay: false)
        var queue: [Moment] = []
        for _ in 0..<4 { queue += Mix.nextBlock(pool: pool, state: AppState(), cursor: &c) ?? [] }
        XCTAssertEqual(queue.count, 12)
        for i in 0..<(queue.count - 1) {
            XCTAssertEqual(QueueStep.next(in: queue, after: queue[i].id)?.id, queue[i + 1].id)
        }
    }

    // MARK: Diagnose

    func testBackgroundLineCountsTheThreeEntries() {
        let log = """
        2026-10-29 18:00:00  bg: started m1
        2026-10-29 18:02:00  bg: ended m1
        2026-10-29 18:02:00  bg: next m2
        2026-10-29 18:02:01  bg: started m2
        2026-10-29 18:03:00  bg: stalled at m2
        """
        XCTAssertEqual(Diag.backgroundLine(log), "background: started 2, ended 1, next 1")
        XCTAssertEqual(Diag.backgroundLine(""), "background: started 0, ended 0, next 0")
    }
}
