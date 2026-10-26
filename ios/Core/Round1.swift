import Foundation

// Regeln aus App Runde 1, 1:1 aus der Web-App (src/moments/latency.ts, captions.ts, today.ts, form.ts, recall.ts,
// review.ts, src/lib/state.ts, src/lib/vault.ts). Gleiche Zahlen, gleiche Prüfdaten (CoreTests/Round1Tests.swift).
// Nur Foundation, damit die Datei auch ohne Xcode geprüft werden kann.

// MARK: Punkt 1, Wisch bis erstes Bild (R1, E5)

enum Latency {
    static let targetMs = 300
    static let maxSamples = 60

    struct Sample: Codable, Equatable {
        var ms: Int
        /// Moment lag beim Wisch schon geladen im Vorlade-Player
        var buffered: Bool
        var at: Date
    }

    struct Stats: Equatable {
        var n: Int
        var median: Int?
        var p90: Int?
        /// Anteil unter dem Ziel, 0 bis 1
        var underTarget: Double?
    }

    static func add(_ list: [Sample], _ s: Sample) -> [Sample] {
        Array((list + [s]).suffix(maxSamples))
    }

    private static func quantile(_ sorted: [Int], _ q: Double) -> Int {
        let i = Int((q * Double(sorted.count)).rounded(.up)) - 1
        return sorted[min(sorted.count - 1, max(0, i))]
    }

    static func stats(_ list: [Sample], buffered: Bool) -> Stats {
        let ms = list.filter { $0.buffered == buffered }.map(\.ms).sorted()
        guard !ms.isEmpty else { return Stats(n: 0, median: nil, p90: nil, underTarget: nil) }
        return Stats(n: ms.count, median: quantile(ms, 0.5), p90: quantile(ms, 0.9),
                     underTarget: Double(ms.filter { $0 < targetMs }.count) / Double(ms.count))
    }

    static func line(_ label: String, _ s: Stats) -> String {
        guard let median = s.median, let p90 = s.p90, let under = s.underTarget else { return "\(label): no swipes measured yet" }
        return "\(label): median \(median) ms, 90 % within \(p90) ms, \(Int((under * 100).rounded())) % under \(targetMs) ms (\(s.n) swipes)"
    }
}

// MARK: Punkt 2, Tempo (R11)

enum Speed {
    static let standard = 1.5
    static let hold = 2.0
    static let max = 2.0
    /// Einstellbar laut Bauliste: 1x und 1,5x. 2x nur per Halten
    static let options: [Double] = [1, 1.5]

    /// Gespeichertes Tempo, unbekannte Werte fallen auf den Standard zurück
    static func of(_ stored: Double?) -> Double {
        guard let s = stored, options.contains(s) else { return standard }
        return s
    }

    static func clamp(_ r: Double) -> Double { Swift.min(max, Swift.max(0.25, r)) }
}

// MARK: Punkt 4, Untertitel (R12, E6)

enum CaptionMode: String, Codable, CaseIterable {
    case auto, on, off

    var label: String {
        switch self {
        case .auto: return "Auto"
        case .on: return "Always on"
        case .off: return "Always off"
        }
    }
}

enum Captions {
    static func isArabic(_ s: String) -> Bool {
        s.unicodeScalars.contains { (0x0600...0x06FF).contains($0.value) }
    }

    static func hasCues(_ texts: [String]) -> Bool {
        texts.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Auto: englisches Video aus, Audio an, Arabisch an
    static func defaultOn(texts: [String], audio: Bool) -> Bool {
        hasCues(texts) && (audio || texts.contains { isArabic($0) })
    }

    static func shown(_ mode: CaptionMode?, texts: [String], audio: Bool) -> Bool {
        guard hasCues(texts) else { return false }
        switch mode ?? .auto {
        case .on: return true
        case .off: return false
        case .auto: return defaultOn(texts: texts, audio: audio)
        }
    }
}

// MARK: Punkt 6, Tageszahl (E1, R18, R22)

struct DayCount: Codable, Equatable {
    var seen = 0
    var gotIt = 0
}

enum Today {
    static let keep = 60

    static func countSeen(_ days: [String: DayCount], _ day: String) -> [String: DayCount] {
        var next = days
        next[day, default: DayCount()].seen += 1
        let keys = next.keys.sorted()
        for k in keys.prefix(Swift.max(0, keys.count - keep)) { next[k] = nil }
        return next
    }

    static func countGotIt(_ days: [String: DayCount], _ day: String) -> [String: DayCount] {
        var next = days
        next[day, default: DayCount()].gotIt += 1
        return next
    }

    static func line(_ c: DayCount?, withGotIt: Bool) -> String {
        let seen = "today \(c?.seen ?? 0) seen"
        return withGotIt ? "\(seen), \(c?.gotIt ?? 0) got it" : seen
    }
}

// MARK: Punkt 3, Formwahl (E4)

enum FeedForm: String, Codable, CaseIterable {
    case video, audio, text

    var label: String {
        switch self {
        case .video: return "Video"
        case .audio: return "Audio"
        case .text: return "Text"
        }
    }
}

/// Die Wahl ist ein Filter, keine Darstellung. Sie trennt nach dem Feld form des Moments.
/// Bis das Feld im Pool ist: audio true heißt audio, sonst video. Text gibt es nur mit form text.
/// Gleiche Regel wie src/moments/form.ts (formOf, inForm, emptyFormLine).
enum FormFilter {
    static func of(form: String?, audio: Bool) -> FeedForm {
        form.flatMap(FeedForm.init(rawValue:)) ?? (audio ? .audio : .video)
    }

    static func includes(form: String?, audio: Bool, _ f: FeedForm) -> Bool { of(form: form, audio: audio) == f }

    static func emptyLine(_ f: FeedForm) -> String { f == .text ? "Text sources coming" : "No \(f.rawValue) moments yet" }
}

enum FormText {
    /// Der geprüfte Ausschnitt (Zeilenumbrüche bleiben), ohne Ausschnitt die Untertitel als Fließtext
    static func text(excerpt: String?, cues: [String]) -> String {
        if let e = excerpt?.trimmingCharacters(in: .whitespacesAndNewlines), !e.isEmpty { return e }
        return cues.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }

    /// "Gesehen" erst, wenn das Textende sichtbar war
    static func endReached(offset: Double, visible: Double, content: Double) -> Bool {
        offset + visible >= content - 4
    }
}

// MARK: Punkt 5, Abrufkarte (R7, R8, R9, R10, R22)

enum Recall {
    static let every = 4
    static let minWatched = 0.8
    static let firstGapDays = 7.0
    static let savedGapDays = 21.0
    static let day: TimeInterval = 86_400

    struct Result: Codable, Equatable {
        var at: Date
        var got: Bool
    }

    struct Item: Codable, Equatable {
        var id: String
        /// nächste Fälligkeit, nil = abgeschlossen
        var due: Date?
        var results: [Result]
    }

    typealias State = [String: Item]

    struct Recent: Equatable {
        var id: String
        /// geschauter Anteil 0 bis 1
        var watched: Double
    }

    struct Pick: Equatable {
        var id: String
        var review: Bool
    }

    /// Fest nach jedem 4. gesehenen Moment
    static func cardDue(_ seenInSession: Int) -> Bool { seenInSession > 0 && seenInSession % every == 0 }

    /// Zuerst eine fällige Wiedervorlage, sonst der zuletzt gesehene der letzten 4 mit mindestens 80 %, noch nie abgefragt
    static func pick(_ recall: State, recent: [Recent], now: Date, available: (String) -> Bool) -> Pick? {
        let due = recall.values
            .filter { $0.due.map { $0 <= now } ?? false && available($0.id) }
            .sorted { ($0.due ?? now) < ($1.due ?? now) }
            .first
        if let due { return Pick(id: due.id, review: true) }
        let fresh = recent.suffix(every).reversed().first { $0.watched >= minWatched && recall[$0.id] == nil && available($0.id) }
        return fresh.map { Pick(id: $0.id, review: false) }
    }

    static func answer(_ recall: State, id: String, got: Bool, now: Date, saved: Bool) -> State {
        let prev = recall[id] ?? Item(id: id, due: nil, results: [])
        let results = prev.results + [Result(at: now, got: got)]
        let due: Date?
        if !got {
            due = now.addingTimeInterval(firstGapDays * day)
        } else {
            // Erste Karte: 7-Tage-Wiedervorlage. Erstes "Got it" in einer Wiedervorlage: gespeichert noch 21 Tage, sonst fertig
            let reviewGots = results.dropFirst().filter(\.got).count
            if prev.results.isEmpty { due = now.addingTimeInterval(firstGapDays * day) }
            else if saved && reviewGots == 1 { due = now.addingTimeInterval(savedGapDays * day) }
            else { due = nil }
        }
        var next = recall
        next[id] = Item(id: id, due: due, results: results)
        return next
    }

    /// "Gekonnt" nur nach "Got it"
    static func isKnown(_ recall: State, _ id: String) -> Bool { recall[id]?.results.contains { $0.got } ?? false }
}

// MARK: Punkt 7, Wochenrückblick (R13, R14, R16)

struct WeekPlan: Codable, Equatable {
    var when: String
    var will: String
    /// in der Folgewoche beantwortet
    var happened: Bool?
}

enum WeekReview {
    /// Ein Plan zählt erst mit beiden Teilen, jeder mindestens 3 Zeichen
    static func planComplete(when: String, will: String) -> Bool {
        when.trimmingCharacters(in: .whitespaces).count >= 3 && will.trimmingCharacters(in: .whitespaces).count >= 3
    }

    /// Zahlen nur zur Aufgabe: Tageszahlen der letzten 7 Tage, umgesetzte gespeicherte Momente der letzten 7 Tage
    static func task(dayCount: [String: DayCount], days: [String], applied: Int) -> (seen: Int, gotIt: Int, applied: Int) {
        let seen = days.reduce(0) { $0 + (dayCount[$1]?.seen ?? 0) }
        let got = days.reduce(0) { $0 + (dayCount[$1]?.gotIt ?? 0) }
        return (seen, got, applied)
    }

    static func line(seen: Int, gotIt: Int, applied: Int) -> String { "\(seen) seen, \(gotIt) got it, \(applied) applied" }
}

// MARK: Schlüsselsicherung (Max, 26.10.2026)

enum KeyBackup {
    /// Was beim Start passiert: Schlüssel aus Keychain oder Datei, die fehlende Kopie wird nachgetragen
    struct Plan: Equatable {
        var key: Data?
        var writeKeychain: Bool
        var writeFile: Bool
    }

    static func plan(keychain: Data?, file: Data?) -> Plan {
        let valid: (Data?) -> Data? = { d in d.flatMap { $0.count == 32 ? $0 : nil } }
        let k = valid(keychain), f = valid(file)
        guard let key = k ?? f else { return Plan(key: nil, writeKeychain: false, writeFile: false) }
        return Plan(key: key, writeKeychain: k == nil, writeFile: f == nil || f != key)
    }

    static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Freischalt-Link für ein weiteres Gerät, wie in der Web-App
    static func link(_ key: Data) -> String { "https://amrsaad.github.io/core/#k=\(base64url(key))" }
}
