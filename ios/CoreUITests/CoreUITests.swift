import XCTest

/// Walks through every screen with a local test pool and attaches screenshots.
/// CI exports them, so every change can be looked at before it reaches the phone.
final class CoreUITests: XCTestCase {
    private var app: XCUIApplication!
    private var stateDir: URL!

    override func setUpWithError() throws {
        continueAfterFailure = true
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("core-ui-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        stateDir = tmp
        let poolFile = tmp.appendingPathComponent("pool.json")
        try Self.testPool().write(to: poolFile)
        app = XCUIApplication()
        app.launchEnvironment["CORE_POOL_FILE"] = poolFile.path
        app.launchEnvironment["CORE_STATE_DIR"] = tmp.path
    }

    private func launch(unlocked: Bool = true, review: Bool = false) {
        app.launchEnvironment["CORE_TEST_UNLOCKED"] = unlocked ? "1" : "0"
        app.launchEnvironment["CORE_TEST_REVIEW"] = review ? "1" : "0"
        app.launch()
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func wait(_ s: TimeInterval) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }

    // MARK: Screens

    func test01Unlock() {
        launch(unlocked: false)
        XCTAssertTrue(app.staticTexts["Core"].waitForExistence(timeout: 10))
        shot("01-unlock")
        let field = app.textFields.firstMatch
        field.tap()
        field.typeText("https://amrsaad.github.io/core/#k=not-a-real-key")
        app.buttons["Unlock"].tap()
        wait(0.5)
        shot("02-unlock-invalid")
    }

    func test02Feed() {
        launch()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15), "feed did not appear")
        wait(1.0)
        shot("10-feed-first")
        wait(3.0)
        shot("11-feed-playing-captions")

        // tap pauses
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        wait(0.5)
        shot("12-feed-paused")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        // double tap is More like this with a heart, saving only works through the column
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).doubleTap()
        wait(0.2)
        shot("13-feed-liked-heart")
        XCTAssertEqual(visible("like")?.value as? String, "on", "double tap must fill the heart")
        XCTAssertEqual(visible("save")?.value as? String, "off", "double tap must not save")
        visible("save")?.tap()
        wait(0.3)
        XCTAssertEqual(visible("save")?.value as? String, "on", "save button must fill")

        // swipe to next
        app.swipeUp(velocity: .fast)
        wait(2.0)
        shot("14-feed-second")
        app.swipeUp(velocity: .fast)
        wait(2.0)
        shot("15-feed-third")

        openNoteSheet(tag: "16")
        app.buttons["noteDone"].tap()
        wait(0.5)

        // saved tab
        app.tabBars.buttons["Saved"].tap()
        XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 5))
        wait(0.5)
        shot("20-saved")

        // settings tab
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 5))
        wait(0.5)
        shot("30-settings")
        app.swipeUp()
        wait(0.5)
        shot("31-settings-bottom")
        let copy = app.buttons["copyDiagnostics"]
        if copy.exists { copy.tap(); wait(0.3); shot("32-settings-copied") }
    }

    private func diagLog() -> String {
        (try? String(contentsOf: stateDir.appendingPathComponent("diag.log"), encoding: .utf8)) ?? ""
    }

    /// The button with this identifier on the visible page (pages are stacked in a lazy list)
    private func visible(_ id: String) -> XCUIElement? {
        let screen = app.frame
        return app.buttons.matching(identifier: id).allElementsBoundByIndex.first { $0.frame.height > 0 && screen.contains($0.frame) }
    }

    /// Swipes left on the feed and expects the feedback sheet. Attaches hierarchy and app log when it fails.
    private func openNoteSheet(tag: String) {
        app.swipeLeft()
        let done = app.buttons["noteDone"]
        let opened = done.waitForExistence(timeout: 5)
        wait(0.6)
        shot("\(tag)-note-sheet")
        if !opened {
            let t = XCTAttachment(string: app.debugDescription)
            t.name = "\(tag)-note-hierarchy"
            t.lifetime = .keepAlways
            add(t)
        }
        if let log = try? String(contentsOf: stateDir.appendingPathComponent("diag.log"), encoding: .utf8) {
            let t = XCTAttachment(string: log)
            t.name = "\(tag)-diag-log"
            t.lifetime = .keepAlways
            add(t)
        }
        XCTAssertTrue(opened, "\(tag): note sheet did not open")
    }

    /// Punkt 7: Plan der Vorwoche (vorab in state.json gelegt), Zahlenzeile, genau ein Plan, Speichern erst mit Plan
    func test03WeeklyReview() throws {
        try seedState(plans: [Self.prevWeekKey(): ["when": "I finish the OCT clinic on Tuesday", "will": "explain one saved moment to a colleague"]])
        launch(review: true)
        XCTAssertTrue(app.staticTexts["Your week"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["When I finish the OCT clinic on Tuesday, I will explain one saved moment to a colleague."].exists)
        XCTAssertTrue(app.staticTexts["weekLine"].label.hasPrefix("This week: "))
        XCTAssertFalse(app.buttons["savePlan"].isEnabled, "save needs a plan")
        app.buttons["Yes"].tap()
        wait(0.5)
        shot("40-weekly-review-last-week")
        let when = app.textFields["planWhen"]
        when.tap(); when.typeText("I finish the OCT clinic on Tuesday")
        let will = app.textFields["planWill"]
        will.tap(); will.typeText("explain one saved moment to a colleague")
        app.swipeUp()
        wait(0.5)
        shot("41-weekly-review-plan")
        XCTAssertTrue(app.buttons["savePlan"].isEnabled)
        app.buttons["savePlan"].tap()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15))
    }

    /// Punkte 1, 2, 3, 4, 6 und Schlüsselsicherung: Kopfzeile, Textform, Audioform, Settings mit Messung, Tempo, Untertitel, QR-Code
    func test04Round1FeedAndSettings() {
        launch()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15), "feed did not appear")
        XCTAssertTrue(app.buttons["form-Video"].waitForExistence(timeout: 5), "form switch missing")
        XCTAssertTrue(app.staticTexts["todayLine"].label.hasPrefix("today "), "day count missing")
        wait(2)
        shot("50-feed-top-bar")
        app.buttons["form-Text"].tap()
        XCTAssertTrue(app.otherElements["textView"].waitForExistence(timeout: 5) || app.scrollViews["textView"].waitForExistence(timeout: 2), "text view missing")
        XCTAssertTrue(app.staticTexts["Written source: how to document a pupil exam."].exists || app.staticTexts["Written source: how to read a body fat report."].exists, "text moment hook missing")
        XCTAssertFalse(app.staticTexts["Rest two minutes between heavy sets."].exists, "video moment in text filter")
        wait(0.5)
        shot("51-form-text")
        app.buttons["form-Video"].tap()
        wait(1)
        // Wischer, damit die Messung Werte hat. Die Beat-Momente laufen über YouTube und spielen im Simulator nicht,
        // die anderen haben einen eigenen Stream und werden vorgeladen
        for _ in 0..<4 { app.swipeUp(velocity: .fast); wait(2.5) }
        shot("53-feed-after-swipes")
        // Filter: Video zeigt keine Podcast-Momente
        XCTAssertFalse(app.staticTexts["Written source: how to document a pupil exam."].exists, "text moment in video filter")
        XCTAssertFalse(app.staticTexts["Do not compare body fat across measuring devices."].exists, "audio moment in video filter")
        XCTAssertFalse(app.staticTexts["Reader studies might favor computer aid. Connie showed real-life harm."].exists, "audio moment in video filter")
        // Audio: nur Podcast-Momente, Untertitel immer an und groß
        app.buttons["form-Audio"].tap()
        wait(3)
        let audioHooks = ["Do not compare body fat across measuring devices.", "Reader studies might favor computer aid. Connie showed real-life harm."]
        XCTAssertTrue(audioHooks.contains { app.staticTexts[$0].exists }, "no audio moment in audio filter")
        XCTAssertFalse(app.staticTexts["Rest two minutes between heavy sets."].exists, "video moment in audio filter")
        shot("52-form-audio")
        app.buttons["form-Video"].tap()
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 5))
        let lat = app.staticTexts["latencyPreloaded"]
        for _ in 0..<4 where !lat.isHittable { app.swipeUp(); wait(0.3) }
        let cold = app.staticTexts["latencyCold"]
        XCTAssertTrue(lat.label.contains("median") || cold.label.contains("median"), "no swipe measured: \(lat.label) / \(cold.label)")
        let m = XCTAttachment(string: lat.label + "\n" + cold.label)
        m.name = "54-latency-values"
        m.lifetime = .keepAlways
        add(m)
        shot("54-settings-player")
        let qr = app.buttons["showQR"]
        for _ in 0..<4 where !qr.isHittable { app.swipeUp(); wait(0.3) }
        qr.tap()
        XCTAssertTrue(app.images["unlockQR"].waitForExistence(timeout: 5), "QR missing")
        XCTAssertEqual(app.staticTexts["keyBackups"].label, "Key saved in Keychain yes · in file copy yes")
        app.swipeUp(); wait(0.5)
        shot("55-settings-unlock-device")
    }

    /// Aufgabe 3: Spalte, Doppeltipp, Menü, Messung
    func test08Actions() {
        launch()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15), "feed did not appear")
        wait(1)
        for id in ["like", "save", "source"] {
            let b = visible(id)
            XCTAssertNotNil(b, "\(id) missing")
            XCTAssertGreaterThanOrEqual(b?.frame.width ?? 0, 48, "\(id) narrower than 48 pt")
            XCTAssertGreaterThanOrEqual(b?.frame.height ?? 0, 48, "\(id) lower than 48 pt")
        }
        XCTAssertNil(visible("menuButton"), "the options menu is gone")
        XCTAssertFalse(app.buttons["Options"].exists, "the options menu is gone")
        shot("80-column")
        // button fills at once and undoes on the second tap
        visible("like")?.tap()
        XCTAssertEqual(visible("like")?.value as? String, "on")
        visible("like")?.tap()
        XCTAssertEqual(visible("like")?.value as? String, "off")
        visible("save")?.tap()
        XCTAssertEqual(visible("save")?.value as? String, "on")
        visible("save")?.tap()
        XCTAssertEqual(visible("save")?.value as? String, "off")
        // double tap: heart at the tap point, liked, not saved
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.45)).doubleTap()
        shot("81-double-tap-heart")
        // the heart lasts 400 ms, XCTest only returns when the animation is over, so the app logs it
        XCTAssertTrue(diagLog().contains("heart "), "heart missing")
        XCTAssertEqual(visible("like")?.value as? String, "on")
        XCTAssertEqual(visible("save")?.value as? String, "off")
        // the tap measurement needs the settings screen
        // measurement in settings under Player
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 5))
        let tap = app.staticTexts["tapReaction"]
        for _ in 0..<4 where !tap.isHittable { app.swipeUp(); wait(0.3) }
        XCTAssertTrue(tap.label.contains("Median"), "no tap measured: \(tap.label)")
        let m = XCTAttachment(string: tap.label)
        m.name = "83-tap-to-fill"
        m.lifetime = .keepAlways
        add(m)
        shot("84-settings-tap-reaction")
    }

    /// Leerer Filter: eine Zeile statt leerem Feed, Schalter bleibt, Rückkehr zu Video geht
    func test07EmptyFilter() throws {
        try Self.testPool(withAudio: false).write(to: stateDir.appendingPathComponent("pool.json"))
        launch()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15), "feed did not appear")
        app.buttons["form-Audio"].tap()
        XCTAssertTrue(app.staticTexts["No audio moments yet"].waitForExistence(timeout: 5), "empty line missing")
        XCTAssertTrue(app.buttons["form-Video"].exists, "switch must stay")
        wait(0.5)
        shot("57-filter-empty")
        app.buttons["form-Text"].tap()
        XCTAssertTrue(app.staticTexts["Text sources coming"].waitForExistence(timeout: 5), "text empty line missing")
        shot("58-text-empty")
        app.buttons["form-Video"].tap()
        // after the switch the mix is free (the Beat-first rule only holds for the first moment of the day)
        XCTAssertTrue(app.buttons["like"].waitForExistence(timeout: 10), "video feed did not come back")
        XCTAssertFalse(app.staticTexts["No audio moments yet"].exists)
        XCTAssertFalse(app.staticTexts["Text sources coming"].exists)
    }

    /// Punkt 5: kurze Momente laufen von selbst durch, nach dem 4. kommt die Abrufkarte (Multiple Choice)
    func test05RecallCard() throws {
        try Self.testPool(short: true).write(to: stateDir.appendingPathComponent("pool.json"))
        launch()
        let q = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'What follows from'")).firstMatch
        XCTAssertTrue(q.waitForExistence(timeout: 90), "no recall card after 4 moments")
        XCTAssertFalse(app.staticTexts["recallWhy"].exists, "explanation must stay hidden before the choice")
        XCTAssertFalse(app.buttons["recallNext"].exists)
        XCTAssertFalse(app.buttons["Show answer"].exists || app.buttons["Got it"].exists || app.buttons["Missed"].exists || app.buttons["Skip"].exists, "old controls must be gone")
        XCTAssertEqual(app.buttons.matching(identifier: "recallOption").count, 3)
        wait(0.5)
        shot("60-recall-question")
        // wrong choice: chosen red, right one green, explanation and Next
        app.buttons["Wrong answer A"].tap()
        XCTAssertTrue(app.staticTexts["recallWhy"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["Right answer"].value as? String, "right")
        XCTAssertEqual(app.buttons["Wrong answer A"].value as? String, "wrong")
        XCTAssertEqual(app.buttons["Wrong answer B"].value as? String, "rest")
        wait(0.3)
        shot("61-recall-answer")
        app.buttons["recallNext"].tap()
        XCTAssertTrue(app.staticTexts["todayLine"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["todayLine"].label.hasSuffix(", 0 got it"), app.staticTexts["todayLine"].label)
        wait(0.5)
        shot("62-after-recall")
    }

    /// Aufgabe 4: Hook ungekürzt, Tipp klappt die Caption auf, der Ton läuft weiter, Tipp außerhalb und Wischen nach unten klappen zu
    func test09Caption() {
        launch()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15), "feed did not appear")
        wait(1)
        let hook = app.staticTexts.matching(identifier: "hook").allElementsBoundByIndex.first { $0.frame.height > 0 && self.app.frame.contains($0.frame) }
        XCTAssertNotNil(hook, "no hook on screen")
        XCTAssertFalse(app.staticTexts["captionHook"].exists)
        shot("90-hook")
        hook?.tap()
        XCTAssertTrue(app.staticTexts["captionHook"].waitForExistence(timeout: 5), "caption did not open")
        XCTAssertTrue(app.staticTexts["captionExcerpt"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["captionMeta"].label.contains("0:01"), app.descendants(matching: .any)["captionMeta"].label)
        XCTAssertTrue(app.descendants(matching: .any)["captionMeta"].label.contains("Test episode"))
        wait(0.8)
        shot("91-caption-open")
        let log = diagLog()
        XCTAssertTrue(log.contains("caption open playing="), "open not logged")
        // der Ton läuft weiter: Zustand vor und nach dem Aufklappen gleich
        let opened = log.components(separatedBy: "caption open playing=").last?.prefix(5)
        let still = diagLog().components(separatedBy: "caption still playing=").last?.prefix(5)
        XCTAssertEqual(opened?.hasPrefix("true"), still?.hasPrefix("true"), "caption must not pause or start playback")
        // Tipp außerhalb schließt
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
        let closed = NSPredicate(format: "exists == false")
        expectation(for: closed, evaluatedWith: app.staticTexts["captionHook"])
        waitForExpectations(timeout: 5)
        // zweite Stelle: Zeile mit Sprecher und Bereich, zu durch Wischen nach unten
        let line: XCUIElement? = app.staticTexts.matching(identifier: "speakerLine").allElementsBoundByIndex.first { $0.frame.height > 0 && self.app.frame.contains($0.frame) }
        XCTAssertNotNil(line, "no speaker line")
        line?.tap()
        XCTAssertTrue(app.staticTexts["captionHook"].waitForExistence(timeout: 5), "speaker line must open the caption too")
        let from = app.staticTexts["captionHook"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: 220)))
        expectation(for: closed, evaluatedWith: app.staticTexts["captionHook"])
        waitForExpectations(timeout: 5)
        shot("92-caption-closed")
    }

    /// Doppeltipp im Text: More like this mit Herz
    func test10TextDoubleTap() {
        launch()
        XCTAssertTrue(app.buttons["form-Text"].waitForExistence(timeout: 15))
        app.buttons["form-Text"].tap()
        XCTAssertTrue(app.staticTexts["textBody"].waitForExistence(timeout: 10), "text view missing")
        wait(0.5)
        app.staticTexts["textBody"].coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).doubleTap()
        wait(0.3)
        XCTAssertTrue(diagLog().contains("heart "), "heart missing in text form")
        XCTAssertEqual(visible("like")?.value as? String, "on", "double tap in text must like")
        shot("93-text-double-tap")
    }

    /// Rückmeldung: Wisch nach links, sechs Chips, Textfeld, Done. Chip speichert sofort und geht weiter.
    /// Die Zeile "N notes, send?" kommt beim ersten Öffnen am nächsten Tag (CORE_NOTES_DAY), ein Tipp loggt ein Issue.
    func test11Note() {
        app.launchEnvironment["CORE_NOTES_DAY"] = "2026-10-27"
        launch()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15), "feed did not appear")
        wait(1)
        XCTAssertFalse(app.buttons["notesPrompt"].exists, "no notes yet, no prompt")
        // the old ways are gone
        XCTAssertNil(visible("menuButton"))
        visible("like")?.press(forDuration: 0.8)
        wait(0.6)
        XCTAssertFalse(app.buttons["noteDone"].exists, "long press on the heart must not open the sheet any more")
        // swipe left opens one level: six chips, text field, Done, no Send
        openNoteSheet(tag: "94")
        for chip in ["Known", "Wrong", "Boring", "Bad cut", "Great", "Mute speaker"] {
            let b = app.buttons["noteChip-\(chip)"]
            XCTAssertTrue(b.exists, "chip \(chip) missing")
            XCTAssertGreaterThanOrEqual(b.frame.height, 48, "chip \(chip) too small")
        }
        XCTAssertFalse(app.buttons["noteSend"].exists, "no send button")
        // Done without text saves nothing and closes
        app.buttons["noteDone"].tap()
        wait(0.8)
        XCTAssertFalse(diagLog().contains("note saved"), "empty Done must not save")
        // a chip saves at once, the sheet closes, the feed moves on
        openNoteSheet(tag: "95")
        app.buttons["noteChip-Boring"].tap()
        wait(1.2)
        XCTAssertTrue(diagLog().contains("note saved"), "chip did not save")
        XCTAssertFalse(app.buttons["noteDone"].exists, "sheet must close after a chip")
        XCTAssertFalse(diagLog().contains("toast Wrong"), "Boring has no effect")
        // text with Done
        openNoteSheet(tag: "96")
        app.descendants(matching: .any)["noteText"].tap()
        app.descendants(matching: .any)["noteText"].typeText("Cut is late")
        shot("96-note-text")
        app.buttons["noteDone"].tap()
        wait(1.2)
        XCTAssertFalse(app.buttons["noteDone"].exists, "sheet must close after Done")
        // Wrong acts like before: toast
        openNoteSheet(tag: "97")
        app.buttons["noteChip-Wrong"].tap()
        wait(0.6)
        XCTAssertTrue(diagLog().contains("toast Wrong"), "toast for Wrong missing")
        XCTAssertFalse(app.buttons["notesPrompt"].exists, "prompt only on the first open of a day")
        // next day: first open shows the line, one tap logs a single issue and the notes count as sent
        wait(0.5)
        app.terminate()
        app.launchEnvironment["CORE_NOTES_DAY"] = "2026-10-28"
        launch()
        let prompt = app.buttons["notesPrompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 15), "prompt missing on the next day")
        XCTAssertEqual(prompt.label, "3 notes, send?")
        XCTAssertGreaterThanOrEqual(prompt.frame.height, 48)
        shot("98-notes-send")
        prompt.tap()
        wait(0.8)
        let log = diagLog()
        XCTAssertTrue(log.contains("notes url https://github.com/amrsaad/core-content/issues/new?title=Core%20feedback%202026-10-28"), "no issue address logged")
        XCTAssertTrue(log.contains("labels=feedback"), "label missing")
        XCTAssertTrue(log.contains("Boring"), "chip missing in body")
        XCTAssertTrue(log.contains("Cut%20is%20late"), "text missing in body")
        XCTAssertFalse(app.buttons["notesPrompt"].exists, "line must go after sending")
        // same day again: nothing to send, no line
        app.terminate()
        launch()
        XCTAssertTrue(app.buttons["form-Video"].waitForExistence(timeout: 15))
        wait(1)
        XCTAssertFalse(app.buttons["notesPrompt"].exists, "sent notes must not come back")
    }

    /// Aufgabe 6: Quellenzeile unter der Passage, antippbar, "Quoted from" nur bei vorbehaltenen Rechten
    func test12SourceLine() {
        launch()
        XCTAssertTrue(app.buttons["form-Text"].waitForExistence(timeout: 15))
        app.buttons["form-Text"].tap()
        XCTAssertTrue(app.staticTexts["textBody"].waitForExistence(timeout: 10), "text view missing")
        var seen: [String] = []
        for _ in 0..<2 {
            let src = app.descendants(matching: .any)["textSource"]
            for _ in 0..<4 where !src.exists || !src.isHittable { app.swipeUp(velocity: .slow); wait(0.3) }
            XCTAssertTrue(src.exists, "source line missing")
            seen.append(src.label)
            if seen.count == 1 { shot("97-source-line") }
            if seen.count == 2 { shot("98-source-line-reserved") }
            if seen.count == 1 {
                src.tap()
                wait(0.4)
                XCTAssertTrue(diagLog().contains("source open https://example.org/text"), "tap did not open the source")
            }
            app.buttons["textNext"].tap()
            wait(1)
        }
        XCTAssertEqual(seen.filter { $0.hasPrefix("Quoted from ") }.count, 1, "exactly the reserved passage says Quoted from: \(seen)")
        XCTAssertTrue(seen.contains { $0.hasPrefix("Jane Roe") && $0.hasSuffix("CC BY 4.0") }, "\(seen)")
        XCTAssertTrue(seen.contains { $0.hasPrefix("Quoted from Jordan Feigenbaum") && $0.hasSuffix("All rights reserved") }, "\(seen)")
    }

    /// Schlüsselsicherung: Dateikopie gelöscht, die App trägt sie beim Start aus dem Keychain nach (und umgekehrt)
    func test06KeyRestore() throws {
        // Entsperrt heißt: der Feed mit Formschalter ist da (welcher Bereich zuerst kommt, hängt vom Tag ab)
        let unlocked = { self.app.buttons["form-Video"].waitForExistence(timeout: 15) }
        launch()
        XCTAssertTrue(unlocked())
        app.terminate()
        let file = stateDir.appendingPathComponent("key.bin"), chain = stateDir.appendingPathComponent("keychain-test.bin")
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        try FileManager.default.removeItem(at: file)
        launch()
        XCTAssertTrue(unlocked(), "not unlocked after file copy was deleted")
        shot("70-key-restored-from-keychain")
        app.terminate()
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path), "file copy not restored")
        try FileManager.default.removeItem(at: chain)
        launch()
        XCTAssertTrue(unlocked(), "not unlocked after keychain copy was deleted")
        shot("71-key-restored-from-file")
        app.terminate()
        XCTAssertTrue(FileManager.default.fileExists(atPath: chain.path), "keychain copy not restored")
    }

    // MARK: State fixture

    /// Montag der Vorwoche wie Store.prevWeekKey
    static func prevWeekKey() -> String {
        var cal = Calendar(identifier: .iso8601)
        cal.timeZone = .current
        let d = Date().addingTimeInterval(-7 * 86_400)
        let monday = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: d)) ?? d
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: monday)
    }

    private func seedState(plans: [String: [String: String]]) throws {
        let s: [String: Any] = [
            "seen": [:], "weights": ["area": [:], "channel": [:], "topic": [:]], "saved": [:], "muted": [:], "feedTime": [:], "log": [],
            "weekReviewShown": [:], "captions": true, "areaShares": ["brain": 0.34, "body": 0.33, "beat": 0.33], "plans": plans,
        ]
        try JSONSerialization.data(withJSONObject: s).write(to: stateDir.appendingPathComponent("state.json"))
    }

    // MARK: Fixture

    /// Ten moments: six video, two audio (audio true), two text (form text). Streams are the bundled sample video, so playback really runs in the simulator.
    private static func testPool(short: Bool = false, withAudio: Bool = true) throws -> Data {
        let bundle = Bundle(for: CoreUITests.self)
        let video = bundle.url(forResource: "sample", withExtension: "mp4")!.absoluteString
        let thumb = bundle.url(forResource: "thumb", withExtension: "png")!.absoluteString
        func m(_ id: String, _ area: String, _ topic: String, _ channel: String, _ hook: String, forYou: String? = nil, audio: Bool = false, youTube: Bool = false, text: Bool = false) -> [String: Any] {
            var d: [String: Any] = [
                // YouTube-Momente brauchen eine echte 11-stellige ID (Vertrag, PoolContract), sonst sortiert die App sie aus
                "id": id, "videoId": youTube ? id.padding(toLength: 11, withPad: "x", startingAt: 0) : id, "start": 1, "end": short ? 6 : 41, "channel": channel, "area": area, "topic": topic, "hook": hook,
                "kind": "story", "thumb": thumb, "videoTitle": "Test episode",
                "recall": ["question": "What follows from \(id)?", "options": ["Wrong answer A", "Right answer", "Wrong answer B"], "correct": 1, "why": "Because the moment says so."],
                "excerpt": "This is the checked excerpt of the moment, shown as text.\nIt keeps its line breaks at sentence ends.\nThe text form counts a moment as seen only once its end was on screen.",
                "cues": [[0, "This is the first caption line of the sample stream."], [3, "It changes every few seconds, like a real moment."], [6, "Captions sit under the video band in design A."], [9, "The end comes at forty-one seconds."]],
            ]
            if (!youTube || short) && !text { d["hls"] = video; d["url"] = "https://example.com/full" }
            if text {
                d["form"] = "text"
                // Quellenzeile: text1 offen lizenziert, text2 mit vorbehaltenen Rechten
                d["author"] = id == "text1" ? "Jane Roe" : "Jordan Feigenbaum"
                d["ref"] = "Ref \(id)"
                d["sourceUrl"] = "https://example.org/\(id)"
                d["license"] = id == "text1" ? "CC BY 4.0" : "Alle Rechte vorbehalten, frei lesbar. Private Nutzung, Passagen mit Quellenangabe"
            }
            if audio { d["audio"] = true }
            if let f = forYou { d["forYou"] = f }
            return d
        }
        let pool: [String: Any] = [
            "updatedAt": "2026-10-23T04:46:00Z",
            "moments": [
                m("beat1", "beat", "islam", "Yaqeen Institute (Dr. Omar Suleiman)", "The Prophet ﷺ asks for her hand, but for Julaybib.", youTube: true),
                m("beat2", "beat", "islam", "Alalwani Tadabbur", "One verse, read slowly, changes how you pray.", youTube: true),
                m("body1", "body", "nutrition", "Sigma Nutrition (Prof. Grant Tinsley)", "Do not compare body fat across measuring devices.", forYou: short ? nil : "You measure with the Navy method. If you switch devices, the first new reading is your new baseline.", audio: true),
                m("body2", "body", "strength", "Stronger By Science", "Three hard sets beat ten easy ones for strength."),
                m("brain1", "brain", "eyes", "Cybersight (Dr. Daniel Neely)", "A relative afferent pupillary defect is never caused by a cataract."),
                m("brain2", "brain", "ai", "NEJM AI Grand Rounds", "Reader studies might favor computer aid. Connie showed real-life harm.", audio: true),
                m("body3", "body", "strength", "Stronger By Science", "Rest two minutes between heavy sets."),
                m("brain3", "brain", "eyes", "Cybersight (Dr. Daniel Neely)", "Check the pupils before you order imaging."),
                m("text1", "brain", "eyes", "Cybersight (Dr. Daniel Neely)", "Written source: how to document a pupil exam.", text: true),
                m("text2", "body", "nutrition", "Sigma Nutrition (Prof. Grant Tinsley)", "Written source: how to read a body fat report.", text: true),
            ].filter { withAudio || ($0["audio"] == nil && $0["form"] == nil) },
        ]
        return try JSONSerialization.data(withJSONObject: pool, options: [.prettyPrinted])
    }
}
