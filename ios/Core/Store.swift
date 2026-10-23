import Foundation
import SwiftUI

struct Weights: Codable, Equatable {
    var area: [String: Double] = [:]
    var channel: [String: Double] = [:]
    var topic: [String: Double] = [:]
}

struct SavedMoment: Codable, Identifiable, Equatable {
    var moment: Moment
    var savedAt: Date
    var done: Bool = false
    var id: String { moment.id }
}

struct LogEntry: Codable, Equatable {
    var id: String
    var day: String
    var ended: Bool
    var watched: Double
    var feedback: String?
}

/// Everything Core remembers on this phone. Stored as one JSON file.
struct AppState: Codable, Equatable {
    var seen: [String: Date] = [:]
    var weights = Weights()
    var saved: [String: SavedMoment] = [:]
    var muted: [String: String] = [:]
    /// seconds in the feed per local day (yyyy-MM-dd)
    var feedTime: [String: Double] = [:]
    var log: [LogEntry] = []
    var momentDay: String?
    var weekReviewShown: [String: Bool] = [:]
    var captions: Bool = true
    var areaShares: [String: Double] = ["brain": 1.0 / 3, "body": 1.0 / 3, "beat": 1.0 / 3]
}

enum Day {
    static func key(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Monday of the date's week as yyyy-MM-dd
    static func weekKey(_ date: Date = Date()) -> String {
        var cal = Calendar(identifier: .iso8601)
        cal.timeZone = .current
        let monday = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)) ?? date
        return key(monday)
    }
}

@MainActor
final class Store: ObservableObject {
    @Published var state: AppState {
        didSet { if state != oldValue { save() } }
    }

    private static var file: URL {
        Env.stateDir.appendingPathComponent("state.json")
    }

    init() {
        if let data = try? Data(contentsOf: Store.file), let s = try? Self.decoder.decode(AppState.self, from: data) {
            state = s
        } else {
            state = AppState()
        }
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private func save() {
        try? FileManager.default.createDirectory(at: Store.file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? Store.encoder.encode(state) { try? data.write(to: Store.file, options: .atomic) }
    }

    // MARK: Actions

    func signal(_ m: Moment, _ factor: Double) {
        state.weights = Mix.applySignal(state.weights, m, factor)
    }

    func markSeen(_ m: Moment) {
        if state.seen[m.id] == nil { state.seen[m.id] = Date() }
        state.momentDay = Day.key()
    }

    func isSaved(_ m: Moment) -> Bool { state.saved[m.id] != nil }

    func save(_ m: Moment) {
        guard state.saved[m.id] == nil else { return }
        state.saved[m.id] = SavedMoment(moment: m, savedAt: Date())
        signal(m, Mix.Signal.save)
    }

    func unsave(_ m: Moment) {
        state.saved[m.id] = nil
    }

    func log(_ m: Moment, watched: Double, ended: Bool = false, feedback: String? = nil) {
        let day = Day.key()
        if let i = state.log.firstIndex(where: { $0.id == m.id && $0.day == day }) {
            state.log[i].watched = max(state.log[i].watched, watched)
            state.log[i].ended = state.log[i].ended || ended
            if let feedback { state.log[i].feedback = feedback }
        } else {
            state.log.append(LogEntry(id: m.id, day: day, ended: ended, watched: watched, feedback: feedback))
        }
        if state.log.count > 3000 { state.log.removeFirst(state.log.count - 3000) }
    }

    func addFeedTime(_ seconds: Double) {
        state.feedTime[Day.key(), default: 0] += seconds
    }

    func mute(_ m: Moment) {
        state.muted[m.channel] = m.channel
    }

    /// Sunday, first open, not shown this week yet
    var reviewDue: Bool {
        let cal = Calendar(identifier: .gregorian)
        if Env.testReview { return true }
        return cal.component(.weekday, from: Date()) == 1 && state.weekReviewShown[Day.weekKey()] != true
    }
}
