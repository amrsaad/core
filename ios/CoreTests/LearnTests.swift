import XCTest
@testable import Core

/// Lernregeln (Auftrag Max 29.10.2026). Gleiche Prüfdaten wie tests/moments-learn.test.ts.
final class LearnTests: XCTestCase {
    private let t0 = 1_800_000_000_000.0
    private let day = Learn.dayMs
    private let m = Learn.Mom(area: "brain", channel: "Barbell Medicine", topic: "kraft")
    private let other = Learn.Mom(area: "brain", channel: "Sigma Nutrition (Prof. Grant Tinsley)", topic: "ernaehrung")

    private func until(_ w: Weights, _ key: String) -> Until? { w.until?[key] }
    private func near(_ a: Double?, _ b: Double, _ line: UInt = #line) { XCTAssertEqual(a ?? -1, b, accuracy: 1e-3, line: line) }

    // MARK: Skip

    func testSkipCapsChannelAndTopicAtSixTenths() {
        let r = Learn.skip(Weights(), run: nil, m, now: t0)
        near(r.weights.channel[m.channel], 0.6)
        near(r.weights.topic[m.topic], 0.6)
        XCTAssertTrue(r.weights.area.isEmpty)
        XCTAssertNil(r.weights.until)
        XCTAssertEqual(r.run, Learn.SkipRun(channel: m.channel, n: 1))
    }

    func testSkipNeverRaises() {
        var w = Weights()
        w.channel[m.channel] = 0.4
        w.topic[m.topic] = 1.8
        let r = Learn.skip(w, run: nil, m, now: t0)
        near(r.weights.channel[m.channel], 0.4)
        near(r.weights.topic[m.topic], 0.6)
    }

    func testSecondSkipOfSameChannelSetsTwoTenthsForFourteenDaysThenSixTenths() {
        let one = Learn.skip(Weights(), run: nil, m, now: t0)
        let two = Learn.skip(one.weights, run: one.run, m, now: t0 + 5000)
        near(two.weights.channel[m.channel], 0.2)
        near(two.weights.topic[m.topic], 0.6)
        let u = until(two.weights, "c:Barbell Medicine")
        XCTAssertEqual(u, Until(at: t0 + 5000 + 14 * day, back: 0.6))
        XCTAssertEqual(two.run, Learn.SkipRun(channel: m.channel, n: 2))
        near(Learn.settle(two.weights, now: t0 + 5000 + 14 * day - 1).channel[m.channel], 0.2)
        let after = Learn.settle(two.weights, now: t0 + 5000 + 14 * day)
        near(after.channel[m.channel], 0.6)
        XCTAssertNil(after.until)
    }

    func testOtherChannelBetweenBreaksTheRun() {
        let a = Learn.skip(Weights(), run: nil, m, now: t0)
        let b = Learn.skip(a.weights, run: a.run, other, now: t0 + 1)
        XCTAssertEqual(b.run, Learn.SkipRun(channel: other.channel, n: 1))
        near(b.weights.channel[m.channel], 0.6)
        XCTAssertNil(b.weights.until)
        let c = Learn.skip(b.weights, run: b.run, m, now: t0 + 2)
        XCTAssertEqual(c.run.n, 1)
        XCTAssertNil(c.weights.until)
    }

    func testNoRunMeansFirstSkip() {
        let a = Learn.skip(Weights(), run: nil, m, now: t0)
        let b = Learn.skip(a.weights, run: nil, m, now: t0 + 1)
        XCTAssertEqual(b.run.n, 1)
        XCTAssertNil(b.weights.until)
    }

    func testThirdSkipExtendsFromNowAndBackStaysAtSixTenths() {
        var r = Learn.skip(Weights(), run: nil, m, now: t0)
        r = Learn.skip(r.weights, run: r.run, m, now: t0 + 1000)
        r = Learn.skip(r.weights, run: r.run, m, now: t0 + 2 * day)
        XCTAssertEqual(r.run.n, 3)
        XCTAssertEqual(until(r.weights, "c:Barbell Medicine"), Until(at: t0 + 2 * day + 14 * day, back: 0.6))
    }

    func testWeightAlreadyBelowSixTenthsStaysThereAfterwards() {
        var w = Weights()
        w.channel[m.channel] = 0.4
        var r = Learn.skip(w, run: nil, m, now: t0)
        r = Learn.skip(r.weights, run: r.run, m, now: t0 + 1)
        near(until(r.weights, "c:Barbell Medicine")?.back, 0.4)
    }

    // MARK: Not for me, Wrong, Known, Weak

    func testNotForMe() {
        let r = Learn.notForMe(Weights(), m, now: t0)
        near(r.topic[m.topic], 0.2)
        near(r.channel[m.channel], 0.5)
        XCTAssertTrue(r.area.isEmpty)
        XCTAssertEqual(until(r, "t:kraft"), Until(at: t0 + 30 * day, back: 1))
        XCTAssertNil(until(r, "c:Barbell Medicine"))
    }

    func testNotForMeExpiryGoesBackToWeightBeforeCappedAtOne() {
        let plain = Learn.settle(Learn.notForMe(Weights(), m, now: t0), now: t0 + 30 * day)
        near(plain.topic[m.topic], 1)
        XCTAssertNil(plain.until)
        near(plain.channel[m.channel], 0.5)
        var loved = Weights(); loved.topic[m.topic] = 2.4
        near(Learn.settle(Learn.notForMe(loved, m, now: t0), now: t0 + 30 * day).topic[m.topic], 1)
        var weak = Weights(); weak.topic[m.topic] = 0.7
        near(Learn.settle(Learn.notForMe(weak, m, now: t0), now: t0 + 30 * day).topic[m.topic], 0.7)
        near(Learn.settle(Learn.notForMe(Weights(), m, now: t0), now: t0 + 30 * day - 1).topic[m.topic], 0.2)
    }

    func testNotForMeLeavesChannelBelowHalfAlone() {
        var w = Weights(); w.channel[m.channel] = 0.3
        near(Learn.notForMe(w, m, now: t0).channel[m.channel], 0.3)
    }

    func testNotForMeTwiceExtendsTheTerm() {
        var w = Weights(); w.topic[m.topic] = 0.8
        let a = Learn.notForMe(w, m, now: t0)
        let b = Learn.notForMe(a, m, now: t0 + 10 * day)
        XCTAssertEqual(until(b, "t:kraft"), Until(at: t0 + 40 * day, back: 0.8))
    }

    func testWrongKnownWeak() {
        var w = Weights(); w.topic[m.topic] = 1.4; w.channel[m.channel] = 1.4
        let wr = Learn.wrong(w, m, now: t0)
        near(wr.channel[m.channel], 0.5); near(wr.topic[m.topic], 1.4)
        let kn = Learn.known(w, m, now: t0)
        near(kn.topic[m.topic], 0.7); near(kn.channel[m.channel], 1.4)
        let wk = Learn.weak(w, m, now: t0)
        near(wk.channel[m.channel], 0.7); near(wk.topic[m.topic], 1.4)
        XCTAssertTrue(wr.area.isEmpty && kn.area.isEmpty && wk.area.isEmpty)
        var low = Weights(); low.channel[m.channel] = 0.3; low.topic[m.topic] = 0.3
        near(Learn.wrong(low, m, now: t0).channel[m.channel], 0.3)
        near(Learn.known(low, m, now: t0).topic[m.topic], 0.3)
        near(Learn.weak(low, m, now: t0).channel[m.channel], 0.3)
    }

    func testCapsDoNotAddUp() {
        let a = Learn.wrong(Weights(), m, now: t0)
        XCTAssertEqual(Learn.wrong(a, m, now: t0 + 1), a)
        XCTAssertEqual(Learn.known(Learn.known(Weights(), m, now: t0), m, now: t0), Learn.known(Weights(), m, now: t0))
    }

    func testCapAlsoLowersTheWeightAfterOfARunningExpiry() {
        var r = Learn.skip(Weights(), run: nil, m, now: t0)
        r = Learn.skip(r.weights, run: r.run, m, now: t0 + 1)
        let x = Learn.wrong(r.weights, m, now: t0 + 2)
        near(x.channel[m.channel], 0.2)
        near(until(x, "c:Barbell Medicine")?.back, 0.5)
        near(Learn.settle(x, now: t0 + 15 * day).channel[m.channel], 0.5)
    }

    // MARK: More, Save, Ended

    func testFactorsOnChannelTopicAndSoftenedOnArea() {
        for f in [Mix.Signal.more, Mix.Signal.save, Mix.Signal.ended] {
            let r = Learn.signal(Weights(), m, factor: f, now: t0)
            near(r.channel[m.channel], f)
            near(r.topic[m.topic], f)
            near(r.area[m.area], f.squareRoot())
        }
        XCTAssertEqual([Mix.Signal.more, Mix.Signal.save, Mix.Signal.ended, Mix.Signal.back, Mix.Signal.early, Mix.Signal.mostly], [1.3, 1.1, 1.1, 1.1, 0.95, 1.05])
    }

    func testTakingBackTheHeartUndoesMore() {
        let r = Learn.signal(Learn.signal(Weights(), m, factor: Mix.Signal.more, now: t0), m, factor: 1 / Mix.Signal.more, now: t0)
        near(r.channel[m.channel], 1)
        near(r.topic[m.topic], 1)
    }

    func testPositiveSignalAlsoGrowsTheWeightAfterOfARunningExpiry() {
        let a = Learn.notForMe(Weights(), m, now: t0)
        let b = Learn.signal(a, m, factor: Mix.Signal.more, now: t0 + 1000)
        near(b.topic[m.topic], 0.26)
        near(until(b, "t:kraft")?.back, 1.3)
    }

    // MARK: Abläufe

    func testSettleKeepsValueWhenNothingExpired() {
        let a = Learn.notForMe(Weights(), m, now: t0)
        XCTAssertEqual(Learn.settle(a, now: t0 + 1), a)
    }

    func testEveryRuleSettlesFirst() {
        let a = Learn.notForMe(Weights(), m, now: t0)
        let late = t0 + 31 * day
        let k = Learn.known(a, m, now: late)
        near(k.topic[m.topic], 0.7)
        XCTAssertNil(k.until)
        near(Learn.signal(a, m, factor: Mix.Signal.more, now: late).topic[m.topic], 1.3)
    }

    func testSeveralExpiriesRunIndependently() {
        var r = Learn.notForMe(Weights(), m, now: t0)
        let s1 = Learn.skip(r, run: nil, other, now: t0)
        r = s1.weights
        let two = Learn.skip(r, run: Learn.SkipRun(channel: other.channel, n: 1), other, now: t0 + 1)
        let d20 = Learn.settle(two.weights, now: t0 + 20 * day)
        near(d20.channel[other.channel], 0.6)
        near(d20.topic[m.topic], 0.2)
        let d31 = Learn.settle(two.weights, now: t0 + 31 * day)
        near(d31.topic[m.topic], 1)
        XCTAssertNil(d31.until)
    }

    // MARK: Chips und Bestätigungszeile

    func testChipEffects() {
        XCTAssertEqual(Note.chips.map { Note.effect($0) }, [.known, .notForMe, .wrong, .weak, nil, nil, .mute])
        near(Learn.apply(Weights(), .known, m, now: t0).topic[m.topic], 0.7)
        near(Learn.apply(Weights(), .wrong, m, now: t0).channel[m.channel], 0.5)
        near(Learn.apply(Weights(), .weak, m, now: t0).channel[m.channel], 0.7)
        near(Learn.apply(Weights(), .notForMe, m, now: t0).topic[m.topic], 0.2)
        XCTAssertEqual(Learn.apply(Weights(), .mute, m, now: t0), Weights())
    }

    func testConfirmLines() {
        XCTAssertEqual(Learn.confirmLine(.wrong, m), "Less Barbell Medicine")
        XCTAssertEqual(Learn.confirmLine(.weak, m), "Less Barbell Medicine")
        XCTAssertEqual(Learn.confirmLine(.known, m), "Less Kraft")
        XCTAssertEqual(Learn.confirmLine(.notForMe, m), "Less Kraft")
        XCTAssertEqual(Learn.confirmLine(.mute, m), "Barbell Medicine muted")
        XCTAssertEqual(Learn.confirmLine(nil, m), "Noted")
        XCTAssertEqual(Learn.confirmLine(.wrong, other), "Less Sigma Nutrition · Prof. Grant Tinsley")
    }

    // MARK: Karte

    func testLearnedTopAndBottomFive() {
        var w = Weights()
        for i in 0..<8 {
            w.channel[String(format: "k%02d", i)] = 1 + Double(i + 1) / 10
            w.topic[String(format: "k%02d", i)] = 1 - Double(i + 1) / 12
        }
        let l = Learn.learned(w, now: t0)
        XCTAssertEqual(l.channelUp.map(\.key), ["k07", "k06", "k05", "k04", "k03"])
        near(l.channelUp[0].weight, 1.8)
        XCTAssertTrue(l.channelDown.isEmpty)
        XCTAssertEqual(l.topicDown.map(\.key), ["k07", "k06", "k05", "k04", "k03"])
        XCTAssertTrue(l.topicUp.isEmpty)
    }

    func testLearnedSkipsOneAndSortsTiesByName() {
        var w = Weights()
        w.channel = ["b": 1.5, "a": 1.5, "c": 1, "d": 0.5]
        let l = Learn.learned(w, now: t0)
        XCTAssertEqual(l.channelUp.map(\.key), ["a", "b"])
        XCTAssertEqual(l.channelDown.map(\.key), ["d"])
    }

    func testLearnedShowsEffectiveWeightAndEndOfRunningTerm() {
        let a = Learn.notForMe(Weights(), m, now: t0)
        let during = Learn.learned(a, now: t0 + day)
        XCTAssertEqual(during.topicDown.first, Learn.Row(key: "kraft", weight: 0.2, until: t0 + 30 * day))
        XCTAssertEqual(during.channelDown.first, Learn.Row(key: "Barbell Medicine", weight: 0.5, until: nil))
        XCTAssertTrue(Learn.learned(a, now: t0 + 31 * day).topicDown.isEmpty)
    }

    func testWeightTextHasArrow() {
        XCTAssertEqual(Learn.weightText(0.6), "0.60 ↓")
        XCTAssertEqual(Learn.weightText(1.3), "1.30 ↑")
        XCTAssertEqual(Learn.weightText(0.2), "0.20 ↓")
    }

    func testRuleNumbers() {
        XCTAssertEqual([Learn.Rule.skip, Learn.Rule.skipRun, Learn.Rule.skipRunDays, Learn.Rule.notForMeTopic, Learn.Rule.notForMeDays,
                        Learn.Rule.notForMeChannel, Learn.Rule.wrongChannel, Learn.Rule.knownTopic, Learn.Rule.weakChannel],
                       [0.6, 0.2, 14, 0.2, 30, 0.5, 0.5, 0.7, 0.7])
    }

    // MARK: Sync

    func testSyncWireFormatRoundTripsTheExpiries() {
        var s = AppState()
        s.weights = Learn.notForMe(Weights(), m, now: t0)
        let doc = SyncWire.doc(from: s)
        let u = doc["state"]?["momentWeights"]?["until"]?["t:kraft"]
        XCTAssertEqual(u?["at"]?.number, t0 + 30 * day)
        XCTAssertEqual(u?["back"]?.number, 1)
        XCTAssertNil(SyncWire.doc(from: AppState())["state"]?["momentWeights"]?["until"])
    }

    func testStampChangesStampsExpiriesWithTheirWeight() {
        var a = AppState()
        a.weights = Learn.notForMe(Weights(), m, now: t0)
        a.syncTs = [SyncMerge.tsKey(weight: "topic", "kraft"): 1, SyncMerge.tsKey(weight: "channel", "Barbell Medicine"): 1]
        var b = a
        b.weights.until?["t:kraft"] = Until(at: t0 + 99 * day, back: 1)
        let n = SyncWire.stamp(old: a, new: b, now: Date(timeIntervalSince1970: 77))
        XCTAssertEqual(n.syncTs?[SyncMerge.tsKey(weight: "topic", "kraft")], 77_000)
        XCTAssertEqual(n.syncTs?[SyncMerge.tsKey(weight: "channel", "Barbell Medicine")], 1)
    }
}
