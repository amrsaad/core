import Foundation

// Geräte-Sync (Auftrag Max 28.10.2026), Teil 3: Abbildung zwischen AppState und dem Sync-Dokument (siehe Sync.swift).
// Die Namen und Einheiten im Dokument sind die der Web-App (src/lib/sync/merge.ts):
// Zeitpunkte als Millisekunden seit 1970, gemerkte Momente mit ISO-Zeit, Zeit im Feed in Millisekunden.
// Zeitstempel (syncTs) setzt die App zentral bei jeder Änderung (stamp), keine einzelne Aktion muss daran denken.

enum SyncWire {
    // MARK: Zeit

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func iso(_ d: Date) -> String { isoFraction.string(from: d) }
    static func parseISO(_ s: String) -> Date? { isoFraction.date(from: s) ?? isoPlain.date(from: s) }

    // MARK: Moment als JSON

    private static func json<T: Encodable>(_ v: T) -> J? {
        guard let d = try? JSONEncoder().encode(v) else { return nil }
        return SyncJSON.parse(d)
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ j: J) -> T? {
        try? JSONDecoder().decode(T.self, from: SyncJSON.data(j))
    }

    private static func nums(_ m: [String: Double]) -> J { .obj(m.mapValues { J.num($0) }) }
    private static func numbers(_ j: J?) -> [String: Double] { (j?.object ?? [:]).compactMapValues { $0.number } }
    private static func strings(_ j: J?) -> [String: String] { (j?.object ?? [:]).compactMapValues { $0.string } }

    // MARK: Zustand zu Dokument

    /// Das Dokument des Zustands in der gemeinsamen Form (wie toDoc in TypeScript)
    static func doc(from s: AppState) -> J {
        var st = SyncMerge.emptyState()
        st["momentSeen"] = nums(s.seen.mapValues { ms($0) })
        st["momentLog"] = .arr(s.log.map { (e: LogEntry) -> J in
            var o = [String: J]()
            o["id"] = .str(e.id)
            o["day"] = .str(e.day)
            o["ended"] = .bool(e.ended)
            o["watched"] = .num(e.watched)
            if let fb = e.feedback { o["feedback"] = .str(fb) }
            return .obj(o)
        })
        var days = [String: J]()
        for (k, v) in s.dayCount ?? [:] { days[k] = .obj(["seen": .num(Double(v.seen)), "gotIt": .num(Double(v.gotIt))]) }
        st["dayCount"] = .obj(days)
        var saved = [String: J]()
        for (k, v) in s.saved {
            guard let m = json(v.moment) else { continue }
            var o = [String: J]()
            o["moment"] = m
            o["savedAt"] = .str(iso(v.savedAt))
            if v.done { o["done"] = .bool(true) }
            saved[k] = .obj(o)
        }
        st["savedMoments"] = .obj(saved)
        st["momentWeights"] = .obj(["area": nums(s.weights.area), "channel": nums(s.weights.channel), "topic": nums(s.weights.topic)])
        var recall = [String: J]()
        for (k, item) in s.recall ?? [:] {
            var o = [String: J]()
            o["id"] = .str(item.id)
            o["due"] = item.due.map { J.num(ms($0)) } ?? .null
            o["results"] = .arr(item.results.map { (r: Recall.Result) -> J in J.obj(["at": .num(ms(r.at)), "got": .bool(r.got)]) })
            recall[k] = .obj(o)
        }
        st["recall"] = .obj(recall)
        st["feedbackNotes"] = .arr((s.feedbackNotes ?? []).map { (n: Note.Entry) -> J in
            var o = [String: J]()
            o["key"] = .str(n.key)
            o["id"] = .str(n.id)
            o["hook"] = .str(n.hook)
            o["chips"] = .arr(n.chips.map { J.str($0) })
            o["text"] = .str(n.text)
            o["tab"] = .str(n.tab)
            o["commit"] = .str(n.commit)
            o["at"] = .num(Double(n.at))
            if let sent = n.sent { o["sent"] = .num(Double(sent)) }
            return .obj(o)
        })
        st["momentLiked"] = nums((s.liked ?? [:]).mapValues { ms($0) })
        st["mutedChannels"] = .obj(s.muted.mapValues { J.str($0) })
        st["feedTime"] = nums(s.feedTime.mapValues { ($0 * 1000).rounded() })
        st["weekReviewShown"] = .obj(s.weekReviewShown.mapValues { J.bool($0) })
        var plans = [String: J]()
        for (k, p) in s.plans ?? [:] {
            var o = [String: J]()
            o["when"] = .str(p.when)
            o["will"] = .str(p.will)
            if let h = p.happened { o["happened"] = .bool(h) }
            plans[k] = .obj(o)
        }
        st["plans"] = .obj(plans)
        var set = [String: J]()
        set["areaShares"] = nums(s.areaShares)
        if let c = s.captionMode { set["captionMode"] = .str(c.rawValue) }
        if let f = s.form { set["form"] = .str(f.rawValue) }
        if let v = s.playbackSpeed { set["playbackSpeed"] = .num(v) }
        st["settings"] = .obj(set)
        if let d = s.notesPromptDay { st["notesPromptDay"] = .str(d) }
        if let d = s.momentDay { st["momentDay"] = .str(d) }
        let ts = (s.syncTs ?? [:]).mapValues { J.num($0) }
        return SyncMerge.normalized(.obj(["v": .num(Double(SyncMerge.version)), "state": .obj(st), "ts": .obj(ts)]))
    }

    // MARK: Dokument in den Zustand

    /// Nur Felder, die sich ändern, bekommen neue Werte
    static func apply(_ d: J, to s: AppState) -> AppState {
        let cur = doc(from: s)["state"]?.object ?? [:]
        let next = d["state"]?.object ?? [:]
        var out = s
        func differs(_ k: String) -> Bool { cur[k] != next[k] }

        if differs("momentSeen") { out.seen = numbers(next["momentSeen"]).mapValues { date($0) } }
        if differs("momentLog") {
            out.log = (next["momentLog"]?.array ?? []).compactMap { (e: J) -> LogEntry? in
                guard let id = e["id"]?.string, let day = e["day"]?.string else { return nil }
                return LogEntry(id: id, day: day, ended: e["ended"]?.boolean ?? false, watched: e["watched"]?.number ?? 0, feedback: e["feedback"]?.string)
            }
        }
        if differs("dayCount") {
            var days = [String: DayCount]()
            for (k, v) in next["dayCount"]?.object ?? [:] {
                days[k] = DayCount(seen: Int(v["seen"]?.number ?? 0), gotIt: Int(v["gotIt"]?.number ?? 0))
            }
            out.dayCount = days
        }
        if differs("savedMoments") {
            var saved = [String: SavedMoment]()
            for (k, v) in next["savedMoments"]?.object ?? [:] {
                guard let mj = v["moment"], let m = decode(Moment.self, mj), let at = v["savedAt"]?.string.flatMap(parseISO) else { continue }
                saved[k] = SavedMoment(moment: m, savedAt: at, done: v["done"]?.boolean ?? false)
            }
            out.saved = saved
        }
        if differs("momentWeights") {
            let w = next["momentWeights"]
            out.weights = Weights(area: numbers(w?["area"]), channel: numbers(w?["channel"]), topic: numbers(w?["topic"]))
        }
        if differs("recall") {
            var recall = Recall.State()
            for (k, v) in next["recall"]?.object ?? [:] {
                let results: [Recall.Result] = (v["results"]?.array ?? []).compactMap { (r: J) -> Recall.Result? in
                    guard let at = r["at"]?.number else { return nil }
                    return Recall.Result(at: date(at), got: r["got"]?.boolean ?? false)
                }
                recall[k] = Recall.Item(id: v["id"]?.string ?? k, due: v["due"]?.number.map { date($0) }, results: results)
            }
            out.recall = recall
        }
        if differs("feedbackNotes") {
            out.feedbackNotes = (next["feedbackNotes"]?.array ?? []).compactMap { (n: J) -> Note.Entry? in
                guard let key = n["key"]?.string, let id = n["id"]?.string, let at = n["at"]?.number else { return nil }
                let chips = (n["chips"]?.array ?? []).compactMap { $0.string }
                return Note.Entry(key: key, id: id, hook: n["hook"]?.string ?? "", chips: chips, text: n["text"]?.string ?? "", tab: n["tab"]?.string ?? "", commit: n["commit"]?.string ?? "", at: Int(at), sent: n["sent"]?.number.map { Int($0) })
            }
        }
        if differs("momentLiked") { out.liked = numbers(next["momentLiked"]).mapValues { date($0) } }
        if differs("mutedChannels") { out.muted = strings(next["mutedChannels"]) }
        if differs("feedTime") { out.feedTime = numbers(next["feedTime"]).mapValues { $0 / 1000 } }
        if differs("weekReviewShown") {
            out.weekReviewShown = (next["weekReviewShown"]?.object ?? [:]).compactMapValues { $0.boolean }
        }
        if differs("plans") {
            var plans = [String: WeekPlan]()
            for (k, v) in next["plans"]?.object ?? [:] {
                plans[k] = WeekPlan(when: v["when"]?.string ?? "", will: v["will"]?.string ?? "", happened: v["happened"]?.boolean)
            }
            out.plans = plans
        }
        if differs("settings") {
            let set = next["settings"]
            if let shares = set?["areaShares"], !numbers(shares).isEmpty { out.areaShares = numbers(shares) }
            out.captionMode = set?["captionMode"]?.string.flatMap { CaptionMode(rawValue: $0) }
            out.form = set?["form"]?.string.flatMap { FeedForm(rawValue: $0) }
            out.playbackSpeed = set?["playbackSpeed"]?.number
        }
        if let day = next["notesPromptDay"]?.string, day != s.notesPromptDay { out.notesPromptDay = day }
        if let day = next["momentDay"]?.string, day != s.momentDay { out.momentDay = day }
        let ts = numbers(d["ts"])
        if ts != (s.syncTs ?? [:]) { out.syncTs = ts }
        return out
    }

    // MARK: Zeitstempel setzen

    /// Nach jeder Änderung durch die App: Schlüssel, die sich geändert haben (auch weggenommene), bekommen die Zeit der Änderung.
    /// Ohne Änderung kommt derselbe Zustand zurück.
    static func stamp(old: AppState, new: AppState, now: Date) -> AppState {
        var ts = new.syncTs ?? old.syncTs ?? [:]
        let t = ms(now)
        var changed = false
        func diff<T: Equatable>(_ a: [String: T], _ b: [String: T], _ key: (String) -> String) {
            for k in Set(a.keys).union(b.keys) where a[k] != b[k] {
                ts[key(k)] = t
                changed = true
            }
        }
        diff(old.weights.area, new.weights.area) { SyncMerge.tsKey(weight: "area", $0) }
        diff(old.weights.channel, new.weights.channel) { SyncMerge.tsKey(weight: "channel", $0) }
        diff(old.weights.topic, new.weights.topic) { SyncMerge.tsKey(weight: "topic", $0) }
        diff(old.saved, new.saved) { SyncMerge.tsKey(saved: $0) }
        diff(old.liked ?? [:], new.liked ?? [:]) { SyncMerge.tsKey(liked: $0) }
        diff(old.muted, new.muted) { SyncMerge.tsKey(muted: $0) }
        diff(old.plans ?? [:], new.plans ?? [:]) { SyncMerge.tsKey(plan: $0) }
        if old.areaShares != new.areaShares { ts[SyncMerge.tsKey(setting: "areaShares")] = t; changed = true }
        if old.captionMode != new.captionMode { ts[SyncMerge.tsKey(setting: "captionMode")] = t; changed = true }
        if old.form != new.form { ts[SyncMerge.tsKey(setting: "form")] = t; changed = true }
        if old.playbackSpeed != new.playbackSpeed { ts[SyncMerge.tsKey(setting: "playbackSpeed")] = t; changed = true }
        guard changed else { return new }
        var out = new
        out.syncTs = ts
        return out
    }

    /// Hat sich etwas geändert, das zwischen Geräten wandert?
    static func syncedChanged(_ a: AppState, _ b: AppState) -> Bool {
        if a.seen != b.seen { return true }
        if a.log != b.log { return true }
        if a.dayCount != b.dayCount { return true }
        if a.saved != b.saved { return true }
        if a.weights != b.weights { return true }
        if a.recall != b.recall { return true }
        if a.feedbackNotes != b.feedbackNotes { return true }
        if a.notesPromptDay != b.notesPromptDay { return true }
        if a.momentDay != b.momentDay { return true }
        if a.liked != b.liked { return true }
        if a.muted != b.muted { return true }
        if a.feedTime != b.feedTime { return true }
        if a.weekReviewShown != b.weekReviewShown { return true }
        if a.plans != b.plans { return true }
        if a.areaShares != b.areaShares { return true }
        if a.captionMode != b.captionMode { return true }
        if a.form != b.form { return true }
        return a.playbackSpeed != b.playbackSpeed
    }
}
