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

        // double tap saves
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).doubleTap()
        wait(0.3)
        shot("13-feed-saved-flash")

        // swipe to next
        app.swipeUp(velocity: .fast)
        wait(2.0)
        shot("14-feed-second")
        app.swipeUp(velocity: .fast)
        wait(2.0)
        shot("15-feed-third")

        openMenu(tag: "16")
        if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() } else { app.swipeDown() }
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

    /// Taps the visible page's menu button and expects the sheet. Attaches hierarchy and app log when it fails.
    private func openMenu(tag: String) {
        let screen = app.frame
        let menuButton = app.buttons.matching(identifier: "menuButton").allElementsBoundByIndex
            .first { $0.frame.height > 0 && screen.contains($0.frame) }
        XCTAssertNotNil(menuButton, "no visible menu button")
        menuButton?.tap()
        let mute = app.buttons["Mute this channel"]
        let opened = mute.waitForExistence(timeout: 5)
        wait(0.6)
        shot("\(tag)-menu")
        if !opened {
            let t = XCTAttachment(string: app.debugDescription)
            t.name = "\(tag)-menu-hierarchy"
            t.lifetime = .keepAlways
            add(t)
        }
        if let log = try? String(contentsOf: stateDir.appendingPathComponent("diag.log"), encoding: .utf8) {
            let t = XCTAttachment(string: log)
            t.name = "\(tag)-diag-log"
            t.lifetime = .keepAlways
            add(t)
        }
        XCTAssertTrue(opened, "\(tag): menu sheet did not open")
    }

    func test03WeeklyReview() {
        launch(review: true)
        XCTAssertTrue(app.staticTexts["What did you apply?"].waitForExistence(timeout: 15))
        wait(0.5)
        shot("40-weekly-review")
        app.buttons["Continue to feed"].tap()
        XCTAssertTrue(app.staticTexts["Beat"].waitForExistence(timeout: 15))
    }

    // MARK: Fixture

    /// Six moments, two per area. Streams are the bundled sample video, so playback really runs in the simulator.
    private static func testPool() throws -> Data {
        let bundle = Bundle(for: CoreUITests.self)
        let video = bundle.url(forResource: "sample", withExtension: "mp4")!.absoluteString
        let thumb = bundle.url(forResource: "thumb", withExtension: "png")!.absoluteString
        func m(_ id: String, _ area: String, _ topic: String, _ channel: String, _ hook: String, forYou: String? = nil, audio: Bool = false, youTube: Bool = false) -> [String: Any] {
            var d: [String: Any] = [
                "id": id, "videoId": id, "start": 1, "end": 41, "channel": channel, "area": area, "topic": topic, "hook": hook,
                "kind": "story", "thumb": thumb,
                "cues": [[0, "This is the first caption line of the sample stream."], [3, "It changes every few seconds, like a real moment."], [6, "Captions sit under the video band in design A."], [9, "The end comes at forty-one seconds."]],
            ]
            if !youTube { d["hls"] = video; d["url"] = "https://example.com/full" }
            if audio { d["audio"] = true }
            if let f = forYou { d["forYou"] = f }
            return d
        }
        let pool: [String: Any] = [
            "updatedAt": "2026-10-23T04:46:00Z",
            "moments": [
                m("beat1", "beat", "islam", "Yaqeen Institute (Dr. Omar Suleiman)", "The Prophet ﷺ asks for her hand, but for Julaybib.", youTube: true),
                m("beat2", "beat", "islam", "Alalwani Tadabbur", "One verse, read slowly, changes how you pray.", youTube: true),
                m("body1", "body", "nutrition", "Sigma Nutrition (Prof. Grant Tinsley)", "Do not compare body fat across measuring devices.", forYou: "You measure with the Navy method. If you switch devices, the first new reading is your new baseline.", audio: true),
                m("body2", "body", "strength", "Stronger By Science", "Three hard sets beat ten easy ones for strength."),
                m("brain1", "brain", "eyes", "Cybersight (Dr. Daniel Neely)", "A relative afferent pupillary defect is never caused by a cataract."),
                m("brain2", "brain", "ai", "NEJM AI Grand Rounds", "Reader studies might favor computer aid. Connie showed real-life harm.", audio: true),
            ],
        ]
        return try JSONSerialization.data(withJSONObject: pool, options: [.prettyPrinted])
    }
}
