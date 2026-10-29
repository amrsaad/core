import Foundation

/// Lernregeln (Auftrag Max 29.10.2026). Gleiche Regeln wie src/moments/learn.ts, gleiche Prüfdaten in CoreTests/LearnTests.swift.
///
/// Gewichte laufen von 0,2 bis 3, Standard 1. Die Zahlen der negativen Regeln sind Deckel: das Gewicht fällt auf den Wert,
/// steigt aber nie davon. Ein Gewicht unter dem Deckel bleibt, wo es ist.
///
/// - Skip (weniger als 3 s geschaut, nach vorn weggewischt): Kanal und Thema auf höchstens 0,6.
///   Zweiter Skip desselben Kanals in Folge: Kanal auf 0,2 für 14 Tage, danach zurück auf 0,6.
/// - Not for me: Thema auf 0,2 für 30 Tage (danach zurück auf das Gewicht davor, höchstens 1), Kanal auf höchstens 0,5.
/// - Wrong: Kanal auf höchstens 0,5. Known ("Already known"): Thema auf höchstens 0,7. Weak (Chip Boring): Kanal auf höchstens 0,7.
/// - More, Save, Ende, Zurückwischen, früh oder fast ganz weggewischt: Faktor wie bisher (Mix.Signal) auf Kanal und Thema,
///   dazu abgeschwächt auf den Bereich.
///
/// Abläufe stehen als Zeitstempel in den Gewichten (`until`, Schlüssel c:<Kanal> und t:<Thema>, Wert: Ende in ms und Gewicht danach).
/// Nichts läuft im Hintergrund. Wer Gewichte liest, rechnet mit `settle`, abgelaufene Einträge fallen dort auf ihr Gewicht danach.
/// Beim Zusammenführen der Geräte gilt je Schlüssel der jüngste Zeitstempel (SyncMerge).
enum Learn {
    static let dayMs = 86_400_000.0
    /// Weniger als so viele Sekunden geschaut, dann weggewischt: Skip
    static let skipSec = 3.0
    static let listLength = 5

    /// Jetzt in ms seit 1970 (nicht isoliert, damit auch Mix sie lesen kann)
    static var nowMs: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    enum Rule {
        static let skip = 0.6
        static let skipRun = 0.2
        static let skipRunDays = 14.0
        static let notForMeTopic = 0.2
        static let notForMeDays = 30.0
        static let notForMeChannel = 0.5
        static let wrongChannel = 0.5
        static let knownTopic = 0.7
        static let weakChannel = 0.7
    }

    enum Family: String { case channel, topic }

    struct Mom { var area: String; var channel: String; var topic: String }

    static func untilKey(_ fam: Family, _ k: String) -> String { "\(fam == .channel ? "c" : "t"):\(k)" }
    static func parseUntilKey(_ key: String) -> (Family, String) { (key.hasPrefix("c:") ? .channel : .topic, String(key.dropFirst(2))) }

    private static func clamp(_ w: Double) -> Double { Mix.clamp(w) }

    private static func get(_ w: Weights, _ fam: Family, _ k: String) -> Double { (fam == .channel ? w.channel[k] : w.topic[k]) ?? 1 }
    private static func put(_ w: inout Weights, _ fam: Family, _ k: String, _ v: Double) {
        if fam == .channel { w.channel[k] = v } else { w.topic[k] = v }
    }

    /// Abgelaufene Einträge einrechnen: Gewicht fällt auf `back`, der Eintrag entfällt.
    static func settle(_ w: Weights, now: Double) -> Weights {
        guard let u = w.until, u.values.contains(where: { $0.at <= now }) else { return w }
        var out = w
        var rest: [String: Until] = [:]
        for (key, e) in u {
            if e.at > now { rest[key] = e; continue }
            let (fam, k) = parseUntilKey(key)
            put(&out, fam, k, clamp(e.back))
        }
        out.until = rest.isEmpty ? nil : rest
        return out
    }

    /// Gewicht höchstens auf value. Ein laufender Ablauf behält sein "danach", höchstens aber value.
    private static func cap(_ w: Weights, _ fam: Family, _ k: String, _ value: Double) -> Weights {
        var out = w
        put(&out, fam, k, clamp(Swift.min(get(w, fam, k), value)))
        let key = untilKey(fam, k)
        if let e = w.until?[key] {
            var u = w.until ?? [:]
            u[key] = Until(at: e.at, back: clamp(Swift.min(e.back, value)))
            out.until = u
        }
        return out
    }

    /// Gewicht auf höchstens value bis `at`, danach zurück auf das Gewicht davor (höchstens backCap). Läuft schon ein Ablauf, gilt der spätere Termin.
    private static func penalize(_ w: Weights, _ fam: Family, _ k: String, _ value: Double, at: Double, backCap: Double) -> Weights {
        let key = untilKey(fam, k)
        let e = w.until?[key]
        let before = e?.back ?? get(w, fam, k)
        var out = cap(w, fam, k, value)
        var u = out.until ?? [:]
        u[key] = Until(at: e.map { Swift.max($0.at, at) } ?? at, back: clamp(Swift.min(before, backCap)))
        out.until = u
        return out
    }

    /// Läuft nach Faktor wie bisher: Kanal und Thema, dazu abgeschwächt der Bereich. Läuft ein Ablauf, wächst auch das Gewicht danach mit.
    static func signal(_ w0: Weights, _ m: Mom, factor: Double, now: Double) -> Weights {
        let w = settle(w0, now: now)
        var out = w
        out.area[m.area] = clamp((w.area[m.area] ?? 1) * factor.squareRoot())
        out.channel[m.channel] = clamp((w.channel[m.channel] ?? 1) * factor)
        out.topic[m.topic] = clamp((w.topic[m.topic] ?? 1) * factor)
        for (fam, k) in [(Family.channel, m.channel), (Family.topic, m.topic)] {
            let key = untilKey(fam, k)
            if let e = w.until?[key] {
                var u = out.until ?? [:]
                u[key] = Until(at: e.at, back: clamp(e.back * factor))
                out.until = u
            }
        }
        return out
    }

    /// Zähler für "zweiter Skip desselben Kanals in Folge". Jede andere Wertung setzt ihn zurück (nil).
    struct SkipRun: Codable, Equatable {
        var channel: String
        var n: Int
    }

    static func skip(_ w0: Weights, run: SkipRun?, _ m: Mom, now: Double) -> (weights: Weights, run: SkipRun) {
        let n = run.map { $0.channel == m.channel ? $0.n + 1 : 1 } ?? 1
        var w = cap(cap(settle(w0, now: now), .channel, m.channel, Rule.skip), .topic, m.topic, Rule.skip)
        if n >= 2 { w = penalize(w, .channel, m.channel, Rule.skipRun, at: now + Rule.skipRunDays * dayMs, backCap: Rule.skip) }
        return (w, SkipRun(channel: m.channel, n: n))
    }

    static func notForMe(_ w0: Weights, _ m: Mom, now: Double) -> Weights {
        let w = penalize(settle(w0, now: now), .topic, m.topic, Rule.notForMeTopic, at: now + Rule.notForMeDays * dayMs, backCap: 1)
        return cap(w, .channel, m.channel, Rule.notForMeChannel)
    }

    static func wrong(_ w: Weights, _ m: Mom, now: Double) -> Weights { cap(settle(w, now: now), .channel, m.channel, Rule.wrongChannel) }
    static func known(_ w: Weights, _ m: Mom, now: Double) -> Weights { cap(settle(w, now: now), .topic, m.topic, Rule.knownTopic) }
    static func weak(_ w: Weights, _ m: Mom, now: Double) -> Weights { cap(settle(w, now: now), .channel, m.channel, Rule.weakChannel) }

    /// Was ein Chip lernt
    enum Effect: Equatable { case known, wrong, mute, notForMe, weak }

    /// Gewichte nach dem Effekt. Mute ändert die Gewichte nicht, der Sprecher kommt in die Liste der Stummen.
    static func apply(_ w: Weights, _ e: Effect, _ m: Mom, now: Double) -> Weights {
        switch e {
        case .known: return known(w, m, now: now)
        case .wrong: return wrong(w, m, now: now)
        case .notForMe: return notForMe(w, m, now: now)
        case .weak: return weak(w, m, now: now)
        case .mute: return w
        }
    }

    static func cap1(_ s: String) -> String { s.isEmpty ? s : s.prefix(1).uppercased() + s.dropFirst() }

    /// "Sigma Nutrition (Prof. Grant Tinsley)" wird zu "Sigma Nutrition · Prof. Grant Tinsley"
    static func speakerLine(_ channel: String) -> String {
        guard let open = channel.lastIndex(of: "("), channel.hasSuffix(")"), channel.distance(from: open, to: channel.endIndex) > 2 else { return channel }
        let name = channel[..<open].trimmingCharacters(in: .whitespaces)
        let person = channel[channel.index(after: open)..<channel.index(before: channel.endIndex)]
        return "\(name) · \(person)"
    }

    /// Bestätigungszeile am Blatt nach einem Chip. Ohne Effekt (Bad cut, Great): "Noted".
    static func confirmLine(_ e: Effect?, _ m: Mom) -> String {
        switch e {
        case .known, .notForMe: return "Less \(cap1(m.topic))"
        case .wrong, .weak: return "Less \(speakerLine(m.channel))"
        case .mute: return "\(speakerLine(m.channel)) muted"
        case nil: return "Noted"
        }
    }

    struct Row: Equatable {
        var key: String
        var weight: Double
        /// Ende des Ablaufs in ms, solange einer läuft
        var until: Double?
    }

    struct Learned: Equatable {
        var channelUp: [Row]
        var channelDown: [Row]
        var topicUp: [Row]
        var topicDown: [Row]
    }

    /// Karte "What Core learned": je fünf Kanäle und Themen oben (über 1) und unten (unter 1), mit wirksamem Gewicht. Gleichstand nach Name.
    static func learned(_ w0: Weights, now: Double) -> Learned {
        let w = settle(w0, now: now)
        func rows(_ fam: Family) -> [Row] {
            (fam == .channel ? w.channel : w.topic).map { key, weight in Row(key: key, weight: weight, until: w.until?[untilKey(fam, key)]?.at) }
        }
        func up(_ r: [Row]) -> [Row] {
            Array(r.filter { $0.weight > 1.0005 }.sorted { $0.weight != $1.weight ? $0.weight > $1.weight : $0.key.utf16.lexicographicallyPrecedes($1.key.utf16) }.prefix(listLength))
        }
        func down(_ r: [Row]) -> [Row] {
            Array(r.filter { $0.weight < 0.9995 }.sorted { $0.weight != $1.weight ? $0.weight < $1.weight : $0.key.utf16.lexicographicallyPrecedes($1.key.utf16) }.prefix(listLength))
        }
        let c = rows(.channel), t = rows(.topic)
        return Learned(channelUp: up(c), channelDown: down(c), topicUp: up(t), topicDown: down(t))
    }

    /// Anzeige des Gewichts: zwei Stellen, Pfeil nach oben über 1, nach unten unter 1
    static func weightText(_ v: Double) -> String { String(format: "%.2f", v) + (v > 1 ? " ↑" : " ↓") }
}
