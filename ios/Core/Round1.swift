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
    static let missGapDays = 2.0
    static let hitGapDays = 7.0
    static let secondHitGapDays = 21.0
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

    /// Treffer in Folge am Ende der Ergebnisse
    static func trailingHits(_ results: [Result]) -> Int {
        var n = 0
        for r in results.reversed() { if r.got { n += 1 } else { break } }
        return n
    }

    /// Fehler nach 2 Tagen, Treffer nach 7, zweiter Treffer in Folge nach 21, dritter beendet
    static func answer(_ recall: State, id: String, got: Bool, now: Date) -> State {
        let prev = recall[id] ?? Item(id: id, due: nil, results: [])
        let results = prev.results + [Result(at: now, got: got)]
        let hits = trailingHits(results)
        let due: Date?
        if !got { due = now.addingTimeInterval(missGapDays * day) }
        else if hits == 1 { due = now.addingTimeInterval(hitGapDays * day) }
        else if hits == 2 { due = now.addingTimeInterval(secondHitGapDays * day) }
        else { due = nil }
        var next = recall
        next[id] = Item(id: id, due: due, results: results)
        return next
    }

    /// Reihenfolge der Antworten: Indizes in options, zufällig gemischt (Fisher-Yates), gleiche Regel wie Web
    static func shuffleOrder<G: RandomNumberGenerator>(_ n: Int, using g: inout G) -> [Int] {
        var a = Array(0..<n)
        if n > 1 { for i in stride(from: n - 1, to: 0, by: -1) { a.swapAt(i, Int.random(in: 0...i, using: &g)) } }
        return a
    }

    /// "Gekonnt" nur nach einer richtigen Wahl
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

    /// Link für den QR-Code: trägt zusätzlich das Sync-Token mit, verschlüsselt mit dem Pool-Schlüssel (wie die Web-App)
    static func link(_ key: Data, encryptedToken: String?) -> String {
        guard let t = encryptedToken, !t.isEmpty else { return link(key) }
        return link(key) + "&t=\(t)"
    }
}


// MARK: Aufgabe 3, Bedienung (gleiche Regeln wie src/moments/actions.ts)

enum Actions {
    static let heartSeconds = 0.4
    static let confirmSeconds = 0.15
    /// Ziel: Tipp bis Füllung unter 100 ms
    static let targetMs = 100
    static let maxTaps = 60
    /// Zielgröße der Knöpfe in Punkt
    static let targetPt = 48.0

    enum Kind { case more, save, source, known, wrong, mute }

    /// Toast nur bei Mute und Wrong, alles andere bestätigt sich am Knopf
    static func toast(_ k: Kind) -> Bool { k == .mute || k == .wrong }

    /// Doppeltipp setzt nur (bleibt gefüllt), der Knopf schaltet um
    static func nextLiked(_ liked: Bool, double: Bool) -> Bool { double ? true : !liked }

    /// Wischweg in Punkt, ab dem eine Geste zählt
    static let swipePt = 60.0
    enum Swipe: Equatable { case next, prev, note }

    /// Welche Wischgeste ist es? Waagerecht gewinnt, wenn der Weg dort länger ist. Nach links öffnet die Rückmeldung,
    /// nach rechts passiert nichts. Senkrecht: nach oben der nächste Moment, nach unten der vorige.
    static func swipe(dx: Double, dy: Double) -> Swipe? {
        if abs(dx) > abs(dy) { return dx < -swipePt ? .note : nil }
        return dy < -swipePt ? .next : dy > swipePt ? .prev : nil
    }

    struct Tap: Codable, Equatable {
        var ms: Int
        var at: Date
    }

    struct Stats: Equatable {
        var n: Int
        var median: Int?
        var p90: Int?
        var underTarget: Double?
    }

    static func add(_ list: [Tap], _ t: Tap) -> [Tap] { Array((list + [t]).suffix(maxTaps)) }

    private static func quantile(_ sorted: [Int], _ q: Double) -> Int {
        let i = Int((q * Double(sorted.count)).rounded(.up)) - 1
        return sorted[min(sorted.count - 1, max(0, i))]
    }

    static func stats(_ list: [Tap]) -> Stats {
        let ms = list.map(\.ms).sorted()
        guard !ms.isEmpty else { return Stats(n: 0, median: nil, p90: nil, underTarget: nil) }
        return Stats(n: ms.count, median: quantile(ms, 0.5), p90: quantile(ms, 0.9),
                     underTarget: Double(ms.filter { $0 < targetMs }.count) / Double(ms.count))
    }

    static func line(_ s: Stats) -> String {
        guard let median = s.median, let p90 = s.p90, let under = s.underTarget else { return "no taps measured yet" }
        return "Median \(median) ms, 90 % within \(p90) ms, \(Int((under * 100).rounded())) % under \(targetMs) ms (\(s.n) taps)"
    }
}

// MARK: Aufgabe 4, Hook und Caption (Max 27.10.2026)

enum Hook {
    static let maxLines = 3
    static let sizePt: [CGFloat] = [17, 15]
    static let swipeCloseDy: CGFloat = 60

    /// Stufe 0 = normal, 1 = eine Stufe kleiner, nur wenn der Hook in Normalgröße mehr als drei Zeilen braucht. Nie gekürzt.
    static func step(linesAtNormal: Int) -> Int { linesAtNormal > maxLines ? 1 : 0 }

    /// Stelle im Video als Zeit: 1:05, 12:40, 1:02:03
    static func atTime(_ seconds: Double) -> String {
        let s = max(0, Int(seconds))
        let h = s / 3600, m = (s % 3600) / 60, ss = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, ss) : String(format: "%d:%02d", m, ss)
    }

    /// Zuklappen durch Wischen nach unten, nur wenn der Text oben steht
    static func closes(dy: CGFloat, scrollTop: CGFloat) -> Bool { dy > swipeCloseDy && scrollTop <= 0 }
}

// MARK: Rückmeldung in einer Ebene (Max 27.10.2026, ersetzt Aufgabe 5)

/// Wisch nach links öffnet ein Blatt mit sieben Chips und einem Textfeld mit Done. Ein Tipp auf einen Chip speichert sofort lokal.
/// Notizen sammeln sich lokal. Beim ersten Öffnen am Tag, wenn ungesendete Notizen vorliegen, steht "N notes, send?" im Feed.
/// Ein Tipp darauf öffnet ein einziges vorausgefülltes Issue in core-content, danach gelten sie als gesendet.
/// Gleiche Regeln und Prüfdaten wie src/moments/note.ts. Kein Token, kein Netzwerkaufruf der App.
enum Note {
    static let chips = ["Known", "Not for me", "Wrong", "Boring", "Bad cut", "Great", "Mute speaker"]
    static let issueBase = "https://github.com/amrsaad/core-content/issues/new"
    static let label = "feedback"
    /// Freitext je Notiz, damit viele Notizen in eine Adresse passen
    static let textMax = 400
    /// Adressen über etwa 8000 Zeichen nimmt GitHub nicht an. Darunter bleiben wir mit Reserve.
    static let urlMax = 7000
    /// Gesendete Notizen bleiben so lange lokal (Tage)
    static let sentKeepDays = 30

    typealias Effect = Learn.Effect

    /// So lange bleibt das Blatt nach einem Chip mit der Bestätigungszeile offen, dann schließt es und der Feed geht weiter
    static let confirmSheetSeconds = 0.9

    /// Was ein Chip lernt (Learn.swift): Known = Thema 0,7, Not for me = Thema 0,2 für 30 Tage und Kanal 0,5, Wrong = Kanal 0,5,
    /// Boring = Kanal 0,7, Mute speaker = Sprecher stumm. Bad cut und Great speichern nur die Notiz.
    static func effect(_ chip: String) -> Effect? {
        switch chip {
        case "Known": return .known
        case "Wrong": return .wrong
        case "Mute speaker": return .mute
        case "Not for me": return .notForMe
        case "Boring": return .weak
        default: return nil
        }
    }

    struct Entry: Codable, Equatable {
        /// eindeutig je Notiz: Moment-ID und Zeitpunkt
        var key: String
        var id: String
        var hook: String
        var chips: [String]
        var text: String
        /// Reiter zum Zeitpunkt der Notiz: Video, Audio oder Text
        var tab: String
        /// App-Commit zum Zeitpunkt der Notiz
        var commit: String
        /// Millisekunden seit 1970
        var at: Int
        /// Zeitpunkt, an dem die Notiz in ein Issue ging. Fehlt, solange sie ungesendet ist.
        var sent: Int?
    }

    struct Context: Equatable {
        var id: String
        var hook: String
        var tab: String
        var commit: String
    }

    /// Neue Notiz aus Chips und Text. Ohne Chip und ohne Text gibt es keine Notiz.
    static func makeEntry(_ c: Context, chips selected: [String], text: String, at: Int) -> Entry? {
        let t = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(textMax))
        let ordered = chips.filter { selected.contains($0) }
        if ordered.isEmpty && t.isEmpty { return nil }
        return Entry(key: "\(c.id)#\(at)", id: c.id, hook: c.hook, chips: ordered, text: t, tab: c.tab, commit: c.commit, at: at, sent: nil)
    }

    static func unsent(_ list: [Entry]?) -> [Entry] { (list ?? []).filter { $0.sent == nil } }

    /// "1 note, send?" oder "N notes, send?"
    static func promptLine(_ n: Int) -> String { "\(n) \(n == 1 ? "note" : "notes"), send?" }

    static func shouldPrompt(_ n: Int, last: String?, today: String) -> Bool { n > 0 && last != today }

    /// Erstes Öffnen an diesem Tag? Dann wird der Tag vermerkt, und die Zeile erscheint, wenn ungesendete Notizen vorliegen.
    static func firstOpenOfDay(last: String?, today: String) -> Bool { last != today }

    struct Row: Equatable {
        var id: String
        var hook: String
        var chips: [String]
        var text: String
        var tab: String
        var commit: String
        var keys: [String]
    }

    /// Notizen zum selben Moment werden eine Zeile: Chips vereint (Reihenfolge der Liste), Texte mit " / " verbunden
    static func rows(_ list: [Entry]) -> [Row] {
        var out: [Row] = []
        for e in list {
            if let i = out.firstIndex(where: { $0.id == e.id }) {
                out[i].chips = chips.filter { out[i].chips.contains($0) || e.chips.contains($0) }
                out[i].text = [out[i].text, e.text].filter { !$0.isEmpty }.joined(separator: " / ")
                out[i].keys.append(e.key)
            } else {
                out.append(Row(id: e.id, hook: e.hook, chips: e.chips, text: e.text, tab: e.tab, commit: e.commit, keys: [e.key]))
            }
        }
        return out
    }

    /// Eine Tabellenzelle: kein Zeilenumbruch, kein senkrechter Strich
    private static func cell(_ s: String) -> String {
        let parts = s.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return parts.joined(separator: " ").replacingOccurrences(of: "|", with: "/").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let header = ["| Moment | Hook | Chips | Text | Tab | App |", "|---|---|---|---|---|---|"]

    static func rowLine(_ r: Row) -> String {
        let cells = [r.id, r.hook, r.chips.isEmpty ? "-" : r.chips.joined(separator: ", "), r.text.isEmpty ? "-" : r.text, r.tab, r.commit]
        return "| " + cells.map(cell).joined(separator: " | ") + " |"
    }

    static func body(_ list: [Row]) -> String { (header + list.map(rowLine)).joined(separator: "\n") }

    static func title(day: String, n: Int) -> String { "Core feedback \(day), \(n) \(n == 1 ? "moment" : "moments")" }

    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")

    /// Wie encodeURIComponent im Web, dazu ! ' ( ) * kodiert, damit beide dieselbe Adresse bauen
    static func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s }

    static func url(title: String, body: String) -> String {
        "\(issueBase)?title=\(enc(title))&body=\(enc(body))&labels=\(label)"
    }

    struct Built: Equatable {
        var url: String
        /// Schlüssel der Notizen, die in diesem Issue stehen
        var keys: [String]
        var rows: Int
    }

    /// Ein einziges Issue aus allen ungesendeten Notizen, älteste zuerst. Passt nicht alles in die Adresse, kommen so viele Zeilen
    /// hinein wie passen (mindestens eine). Der Rest bleibt ungesendet und geht beim nächsten Mal.
    static func buildIssue(_ list: [Entry], day: String) -> Built? {
        let all = rows(list)
        if all.isEmpty { return nil }
        func make(_ n: Int) -> String { url(title: title(day: day, n: n), body: body(Array(all.prefix(n)))) }
        var k = all.count
        while k > 1 && make(k).count > urlMax { k -= 1 }
        let used = all.prefix(k)
        return Built(url: make(k), keys: used.flatMap(\.keys), rows: k)
    }

    /// Gesendet markieren und alte gesendete Notizen entfernen
    static func markSent(_ list: [Entry]?, keys: [String], at: Int) -> [Entry] {
        let cutoff = at - sentKeepDays * 86_400_000
        return (list ?? []).map { e -> Entry in
            var x = e
            if keys.contains(e.key) { x.sent = at }
            return x
        }.filter { $0.sent == nil || $0.sent! >= cutoff }
    }
}

// MARK: Aufgabe 6, Quellenzeile der Textform

/// Autor, Quelle, Fundstelle, Lizenz unter der Passage. Bei vorbehaltenen Rechten steht "Quoted from " vor dem Namen.
/// Gleiche Regeln und Prüfdaten wie src/moments/source.ts.
enum SourceLine {
    struct Line: Equatable {
        var prefix: String
        var text: String
        var url: URL?
    }

    static func isReserved(_ license: String?) -> Bool {
        guard let l = license?.lowercased() else { return false }
        return l.contains("alle rechte vorbehalten") || l.contains("all rights reserved")
    }

    static func line(author: String?, channel: String?, ref: String?, license: String?, sourceUrl: String?) -> Line? {
        let reserved = isReserved(license)
        let lic = reserved ? "All rights reserved" : (license ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let a = (author ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let c = (channel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let r = (ref ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = [a, c == a ? "" : c, r, lic].filter { !$0.isEmpty }
        if parts.isEmpty { return nil }
        var url: URL?
        if let s = sourceUrl, let u = URL(string: s), let sc = u.scheme?.lowercased(), sc == "http" || sc == "https" { url = u }
        return Line(prefix: reserved ? "Quoted from " : "", text: parts.joined(separator: ", "), url: url)
    }
}

extension Moment {
    var sourceLine: SourceLine.Line? {
        SourceLine.line(author: author, channel: channel, ref: ref, license: license, sourceUrl: sourceUrl)
    }
}
