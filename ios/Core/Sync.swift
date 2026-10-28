import Foundation

// Geräte-Sync (Auftrag Max 28.10.2026), Teil 1: die Zusammenführung. Nur Foundation, damit sie auch unter Linux läuft.
// Gleiche Regeln wie src/lib/sync/merge.ts, gleiche Prüfdaten (tests/fixtures/sync-vectors.json und sync-random.json).
// Das Dokument ist hier ein JSON-Wert (J), damit kein Feld verloren geht und Swift und TypeScript dasselbe Dokument sehen.
// Die Abbildung auf AppState steht in SyncState.swift.

/// Ein JSON-Wert. Zahlen sind immer Double wie in JavaScript.
enum J: Equatable {
    case null
    case bool(Bool)
    case num(Double)
    case str(String)
    case arr([J])
    case obj([String: J])

    var object: [String: J]? { if case .obj(let o) = self { return o } else { return nil } }
    var array: [J]? { if case .arr(let a) = self { return a } else { return nil } }
    var string: String? { if case .str(let s) = self { return s } else { return nil } }
    var number: Double? { if case .num(let d) = self { return d } else { return nil } }
    var boolean: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    var isNull: Bool { if case .null = self { return true } else { return false } }

    subscript(key: String) -> J? { object?[key] }
}

enum SyncJSON {
    // MARK: Lesen

    static func parse(_ data: Data) -> J? {
        var p = Parser(bytes: [UInt8](data))
        p.skipSpace()
        guard let v = p.value() else { return nil }
        p.skipSpace()
        return p.i == p.bytes.count ? v : nil
    }

    static func parse(_ text: String) -> J? { parse(Data(text.utf8)) }

    private struct Parser {
        let bytes: [UInt8]
        var i = 0
        init(bytes: [UInt8]) { self.bytes = bytes }

        mutating func skipSpace() {
            while i < bytes.count, bytes[i] == 0x20 || bytes[i] == 0x0A || bytes[i] == 0x0D || bytes[i] == 0x09 { i += 1 }
        }

        mutating func value() -> J? {
            guard i < bytes.count else { return nil }
            switch bytes[i] {
            case UInt8(ascii: "{"): return object()
            case UInt8(ascii: "["): return array()
            case UInt8(ascii: "\""): return string().map { .str($0) }
            case UInt8(ascii: "t"): return literal("true", .bool(true))
            case UInt8(ascii: "f"): return literal("false", .bool(false))
            case UInt8(ascii: "n"): return literal("null", .null)
            default: return number()
            }
        }

        mutating func literal(_ word: String, _ v: J) -> J? {
            let w = Array(word.utf8)
            guard i + w.count <= bytes.count, Array(bytes[i..<i + w.count]) == w else { return nil }
            i += w.count
            return v
        }

        mutating func number() -> J? {
            let start = i
            while i < bytes.count, "+-0123456789.eE".utf8.contains(bytes[i]) { i += 1 }
            guard i > start, let s = String(bytes: bytes[start..<i], encoding: .utf8), let d = Double(s) else { return nil }
            return .num(d)
        }

        mutating func hex4() -> UInt32? {
            guard i + 4 <= bytes.count, let s = String(bytes: bytes[i..<i + 4], encoding: .utf8), let v = UInt32(s, radix: 16) else { return nil }
            i += 4
            return v
        }

        mutating func string() -> String? {
            guard bytes[i] == UInt8(ascii: "\"") else { return nil }
            i += 1
            var out = [UInt8]()
            while i < bytes.count {
                let c = bytes[i]
                i += 1
                if c == UInt8(ascii: "\"") { return String(bytes: out, encoding: .utf8) }
                if c != UInt8(ascii: "\\") {
                    out.append(c)
                    continue
                }
                guard i < bytes.count else { return nil }
                let e = bytes[i]
                i += 1
                switch e {
                case UInt8(ascii: "\""): out.append(0x22)
                case UInt8(ascii: "\\"): out.append(0x5C)
                case UInt8(ascii: "/"): out.append(0x2F)
                case UInt8(ascii: "b"): out.append(0x08)
                case UInt8(ascii: "f"): out.append(0x0C)
                case UInt8(ascii: "n"): out.append(0x0A)
                case UInt8(ascii: "r"): out.append(0x0D)
                case UInt8(ascii: "t"): out.append(0x09)
                case UInt8(ascii: "u"):
                    guard var u = hex4() else { return nil }
                    if (0xD800..<0xDC00).contains(u), i + 1 < bytes.count, bytes[i] == UInt8(ascii: "\\"), bytes[i + 1] == UInt8(ascii: "u") {
                        i += 2
                        guard let lo = hex4(), (0xDC00..<0xE000).contains(lo) else { return nil }
                        u = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00)
                    }
                    guard let scalar = Unicode.Scalar(u) else { return nil }
                    out.append(contentsOf: Array(String(Character(scalar)).utf8))
                default: return nil
                }
            }
            return nil
        }

        mutating func array() -> J? {
            i += 1
            var out = [J]()
            skipSpace()
            if i < bytes.count, bytes[i] == UInt8(ascii: "]") { i += 1; return .arr(out) }
            while true {
                skipSpace()
                guard let v = value() else { return nil }
                out.append(v)
                skipSpace()
                guard i < bytes.count else { return nil }
                if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
                if bytes[i] == UInt8(ascii: "]") { i += 1; return .arr(out) }
                return nil
            }
        }

        mutating func object() -> J? {
            i += 1
            var out = [String: J]()
            skipSpace()
            if i < bytes.count, bytes[i] == UInt8(ascii: "}") { i += 1; return .obj(out) }
            while true {
                skipSpace()
                guard i < bytes.count, bytes[i] == UInt8(ascii: "\""), let k = string() else { return nil }
                skipSpace()
                guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { return nil }
                i += 1
                skipSpace()
                guard let v = value() else { return nil }
                out[k] = v
                skipSpace()
                guard i < bytes.count else { return nil }
                if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
                if bytes[i] == UInt8(ascii: "}") { i += 1; return .obj(out) }
                return nil
            }
        }
    }

    // MARK: Schreiben (sortierte Schlüssel wie canon() in TypeScript)

    static func canon(_ v: J) -> String {
        var s = ""
        write(v, &s)
        return s
    }

    static func data(_ v: J) -> Data { Data(canon(v).utf8) }

    private static func write(_ v: J, _ s: inout String) {
        switch v {
        case .null: s += "null"
        case .bool(let b): s += b ? "true" : "false"
        case .num(let d): s += numberText(d)
        case .str(let t): quote(t, &s)
        case .arr(let a):
            s += "["
            for (n, x) in a.enumerated() {
                if n > 0 { s += "," }
                write(x, &s)
            }
            s += "]"
        case .obj(let o):
            s += "{"
            for (n, k) in o.keys.sorted(by: { SyncMerge.cmp($0, $1) < 0 }).enumerated() {
                if n > 0 { s += "," }
                quote(k, &s)
                s += ":"
                write(o[k]!, &s)
            }
            s += "}"
        }
    }

    static func numberText(_ d: Double) -> String {
        if d.isNaN || d.isInfinite { return "null" }
        if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        return "\(d)"
    }

    private static func quote(_ t: String, _ s: inout String) {
        s += "\""
        for u in t.unicodeScalars {
            switch u {
            case "\"": s += "\\\""
            case "\\": s += "\\\\"
            case "\n": s += "\\n"
            case "\r": s += "\\r"
            case "\t": s += "\\t"
            case "\u{08}": s += "\\b"
            case "\u{0C}": s += "\\f"
            default:
                if u.value < 0x20 { s += String(format: "\\u%04x", u.value) } else { s.unicodeScalars.append(u) }
            }
        }
        s += "\""
    }
}

enum SyncMerge {
    static let version = 1
    /// wie LOG_MAX in TypeScript und die Grenze im Store
    static let logMax = 3000
    /// wie Today.keep
    static let dayKeep = 60
    typealias O = [String: J]

    // MARK: Hilfen

    /// Vergleich wie in JavaScript (UTF-16 Codeeinheiten), nicht wie Swifts String-Vergleich
    static func cmp(_ a: String, _ b: String) -> Int {
        var x = a.utf16.makeIterator()
        var y = b.utf16.makeIterator()
        while true {
            switch (x.next(), y.next()) {
            case (nil, nil): return 0
            case (nil, _): return -1
            case (_, nil): return 1
            case (let p?, let q?):
                if p != q { return p < q ? -1 : 1 }
            }
        }
    }

    static func emptyState() -> O {
        [
            "momentSeen": .obj([:]), "momentLog": .arr([]), "dayCount": .obj([:]), "savedMoments": .obj([:]),
            "momentWeights": .obj(["area": .obj([:]), "channel": .obj([:]), "topic": .obj([:])]),
            "recall": .obj([:]), "feedbackNotes": .arr([]), "momentLiked": .obj([:]), "mutedChannels": .obj([:]),
            "feedTime": .obj([:]), "weekReviewShown": .obj([:]), "plans": .obj([:]), "settings": .obj([:]),
        ]
    }

    static func emptyDoc() -> J { .obj(["v": .num(Double(version)), "state": .obj(emptyState()), "ts": .obj([:])]) }

    static func tsKey(weight fam: String, _ k: String) -> String { "w:\(fam):\(k)" }
    static func tsKey(saved id: String) -> String { "saved:\(id)" }
    static func tsKey(liked id: String) -> String { "liked:\(id)" }
    static func tsKey(muted ch: String) -> String { "muted:\(ch)" }
    static func tsKey(plan week: String) -> String { "plan:\(week)" }
    static func tsKey(setting k: String) -> String { "set:\(k)" }

    private static func obj(_ v: J?) -> O { v?.object ?? [:] }
    private static func arr(_ v: J?) -> [J] { v?.array ?? [] }
    private static func tsMap(_ v: J?) -> [String: Double] { obj(v).compactMapValues { $0.number } }

    private static func maxStr(_ a: J?, _ b: J?) -> J? {
        guard let x = a?.string else { return b?.string.map { .str($0) } }
        guard let y = b?.string else { return .str(x) }
        return .str(cmp(x, y) >= 0 ? x : y)
    }

    /// Schlüssel je Zeitstempel: der jüngere gewinnt, bei Gleichstand "vorhanden" vor "gelöscht", bei beiden vorhanden die Zusammenführung der Werte
    private static func lww(_ a: O, _ b: O, _ tsA: [String: Double], _ tsB: [String: Double], _ key: (String) -> String, _ combine: (J, J, String) -> J) -> O {
        var out = O()
        for k in Set(a.keys).union(b.keys) {
            let ta = tsA[key(k)] ?? 0
            let tb = tsB[key(k)] ?? 0
            switch (a[k], b[k]) {
            case (let x?, let y?): out[k] = ta > tb ? x : (tb > ta ? y : combine(x, y, k))
            case (let x?, nil): if ta >= tb { out[k] = x }
            case (nil, let y?): if tb >= ta { out[k] = y }
            default: break
            }
        }
        return out
    }

    private static func maxMap(_ a: O, _ b: O) -> O {
        var out = a
        for (k, v) in b {
            if let cur = out[k]?.number, let n = v.number { out[k] = .num(Swift.max(cur, n)) } else { out[k] = v }
        }
        return out
    }

    private static func minMap(_ a: O, _ b: O) -> O {
        var out = a
        for (k, v) in b {
            if let cur = out[k]?.number, let n = v.number { out[k] = .num(Swift.min(cur, n)) } else { out[k] = v }
        }
        return out
    }

    // MARK: Teile

    /// Gewicht bei Gleichstand: das weiter vom Standard 1 entfernte, dann das kleinere
    private static func moreLearned(_ x: J, _ y: J, _ k: String) -> J {
        guard let a = x.number, let b = y.number else { return x }
        let da = abs(log(a))
        let db = abs(log(b))
        return da > db ? x : (db > da ? y : .num(Swift.min(a, b)))
    }

    private static func mergeWeights(_ a: J?, _ b: J?, _ tsA: [String: Double], _ tsB: [String: Double]) -> J {
        var out = O()
        for fam in ["area", "channel", "topic"] {
            out[fam] = .obj(lww(obj(a?[fam]), obj(b?[fam]), tsA, tsB, { tsKey(weight: fam, $0) }, moreLearned))
        }
        return .obj(out)
    }

    private static func pickMoment(_ x: J, _ y: J) -> J {
        let c = cmp(x["createdAt"]?.string ?? "", y["createdAt"]?.string ?? "")
        if c != 0 { return c >= 0 ? x : y }
        let e = cmp(x["excerpt"]?.string ?? "", y["excerpt"]?.string ?? "")
        if e != 0 { return e >= 0 ? x : y }
        return cmp(x["hook"]?.string ?? "", y["hook"]?.string ?? "") >= 0 ? x : y
    }

    private static func combineSaved(_ x: J, _ y: J, _ k: String) -> J {
        var out = O()
        out["moment"] = pickMoment(x["moment"] ?? .null, y["moment"] ?? .null)
        let sx = x["savedAt"]?.string ?? ""
        let sy = y["savedAt"]?.string ?? ""
        out["savedAt"] = .str(cmp(sx, sy) <= 0 ? sx : sy)
        if x["done"]?.boolean == true || y["done"]?.boolean == true { out["done"] = .bool(true) }
        return .obj(out)
    }

    private static func combinePlan(_ x: J, _ y: J, _ k: String) -> J {
        var c = cmp(x["when"]?.string ?? "", y["when"]?.string ?? "")
        if c == 0 { c = cmp(x["will"]?.string ?? "", y["will"]?.string ?? "") }
        let w = c >= 0 ? x : y
        var out = O()
        out["when"] = .str(w["when"]?.string ?? "")
        out["will"] = .str(w["will"]?.string ?? "")
        let hx = x["happened"]?.boolean
        let hy = y["happened"]?.boolean
        if let hx, let hy { out["happened"] = .bool(hx || hy) } else if let h = hx ?? hy { out["happened"] = .bool(h) }
        return .obj(out)
    }

    private static func mergeLog(_ a: [J], _ b: [J]) -> J {
        var m = [String: J]()
        for e in a + b {
            guard let o = e.object else { continue }
            let k = "\(o["day"]?.string ?? "")\u{0}\(o["id"]?.string ?? "")"
            guard let x = m[k]?.object else {
                m[k] = e
                continue
            }
            let endedX: Bool = x["ended"]?.boolean ?? false
            let endedO: Bool = o["ended"]?.boolean ?? false
            let watchedX: Double = x["watched"]?.number ?? 0
            let watchedO: Double = o["watched"]?.number ?? 0
            var out = O()
            out["id"] = o["id"] ?? .str("")
            out["day"] = o["day"] ?? .str("")
            out["ended"] = .bool(endedX || endedO)
            out["watched"] = .num(Swift.max(watchedX, watchedO))
            if let fb = maxStr(x["feedback"], o["feedback"]) { out["feedback"] = fb }
            m[k] = .obj(out)
        }
        var list = Array(m.values)
        list.sort { (p: J, q: J) -> Bool in
            let c = cmp(p["day"]?.string ?? "", q["day"]?.string ?? "")
            if c != 0 { return c < 0 }
            return cmp(p["id"]?.string ?? "", q["id"]?.string ?? "") < 0
        }
        if list.count > logMax { list.removeFirst(list.count - logMax) }
        return .arr(list)
    }

    private static func mergeNotes(_ a: [J], _ b: [J]) -> J {
        var m = [String: J]()
        for e in a + b {
            guard let o = e.object, let key = o["key"]?.string else { continue }
            guard let xj = m[key], let x = xj.object else {
                m[key] = e
                continue
            }
            var c = cmp(x["text"]?.string ?? "", o["text"]?.string ?? "")
            if c == 0 { c = cmp(x["hook"]?.string ?? "", o["hook"]?.string ?? "") }
            if c == 0 { c = cmp(x["commit"]?.string ?? "", o["commit"]?.string ?? "") }
            var out = c >= 0 ? x : o
            let sx = x["sent"]?.number
            let so = o["sent"]?.number
            let sent: Double? = sx == nil ? so : (so == nil ? sx : Swift.max(sx!, so!))
            if let sent { out["sent"] = .num(sent) } else { out["sent"] = nil }
            m[key] = .obj(out)
        }
        var list = Array(m.values)
        list.sort { (u: J, v: J) -> Bool in
            let p: Double = u["at"]?.number ?? 0
            let q: Double = v["at"]?.number ?? 0
            if p != q { return p < q }
            return cmp(u["key"]?.string ?? "", v["key"]?.string ?? "") < 0
        }
        return .arr(list)
    }

    private static func lastAt(_ i: J) -> Double {
        arr(i["results"]).reduce(0) { Swift.max($0, $1["at"]?.number ?? 0) }
    }

    private static func mergeRecallItem(_ x: J, _ y: J) -> J {
        var seen = Set<String>()
        var results = [J]()
        let all = (arr(x["results"]) + arr(y["results"])).sorted { (u: J, v: J) -> Bool in
            let p: Double = u["at"]?.number ?? 0
            let q: Double = v["at"]?.number ?? 0
            if p != q { return p < q }
            let gu: Int = (u["got"]?.boolean ?? false) ? 1 : 0
            let gv: Int = (v["got"]?.boolean ?? false) ? 1 : 0
            return gu < gv
        }
        for r in all {
            let at = r["at"]?.number ?? 0
            let got = r["got"]?.boolean ?? false
            let k = "\(SyncJSON.numberText(at)):\(got)"
            if seen.insert(k).inserted { results.append(.obj(["at": .num(at), "got": .bool(got)])) }
        }
        let lx = lastAt(x)
        let ly = lastAt(y)
        let dx = x["due"]?.number ?? -1
        let dy = y["due"]?.number ?? -1
        let win = lx != ly ? (lx > ly ? x : y) : (dx >= dy ? x : y)
        var out = O()
        out["id"] = x["id"] ?? .str("")
        out["results"] = .arr(results)
        if let due = win["due"] { out["due"] = due }
        return .obj(out)
    }

    private static func mergeRecall(_ a: O, _ b: O) -> J {
        var out = O()
        for k in Set(a.keys).union(b.keys) {
            switch (a[k], b[k]) {
            case (let x?, let y?): out[k] = mergeRecallItem(x, y)
            case (let x?, nil): out[k] = x
            case (nil, let y?): out[k] = y
            default: break
            }
        }
        return .obj(out)
    }

    private static func mergeDayCount(_ a: O, _ b: O) -> J {
        var out = O()
        for k in Set(a.keys).union(b.keys) {
            let seenA: Double = a[k]?["seen"]?.number ?? 0
            let seenB: Double = b[k]?["seen"]?.number ?? 0
            let gotA: Double = a[k]?["gotIt"]?.number ?? 0
            let gotB: Double = b[k]?["gotIt"]?.number ?? 0
            var item = O()
            item["seen"] = .num(Swift.max(seenA, seenB))
            item["gotIt"] = .num(Swift.max(gotA, gotB))
            out[k] = .obj(item)
        }
        let keys = out.keys.sorted { cmp($0, $1) < 0 }
        for k in keys.prefix(Swift.max(0, keys.count - dayKeep)) { out[k] = nil }
        return .obj(out)
    }

    private static func pickSetting(_ x: J, _ y: J, _ k: String) -> J {
        if k == "areaShares" {
            let p = obj(x)
            let q = obj(y)
            for a in Set(p.keys).union(q.keys).sorted(by: { cmp($0, $1) < 0 }) {
                let d = (p[a]?.number ?? 0) - (q[a]?.number ?? 0)
                if d != 0 { return d > 0 ? x : y }
            }
            return x
        }
        if let a = x.number, let b = y.number { return .num(Swift.max(a, b)) }
        func text(_ v: J) -> String { v.string ?? SyncJSON.canon(v) }
        return cmp(text(x), text(y)) >= 0 ? x : y
    }

    // MARK: Zusammenführen

    static func merge(_ a: J, _ b: J) -> J {
        let x = obj(a["state"])
        let y = obj(b["state"])
        let tsA = tsMap(a["ts"])
        let tsB = tsMap(b["ts"])
        var s = O()
        s["momentSeen"] = .obj(minMap(obj(x["momentSeen"]), obj(y["momentSeen"])))
        s["momentLog"] = mergeLog(arr(x["momentLog"]), arr(y["momentLog"]))
        s["dayCount"] = mergeDayCount(obj(x["dayCount"]), obj(y["dayCount"]))
        s["savedMoments"] = .obj(lww(obj(x["savedMoments"]), obj(y["savedMoments"]), tsA, tsB, { tsKey(saved: $0) }, combineSaved))
        s["momentWeights"] = mergeWeights(x["momentWeights"], y["momentWeights"], tsA, tsB)
        s["recall"] = mergeRecall(obj(x["recall"]), obj(y["recall"]))
        s["feedbackNotes"] = mergeNotes(arr(x["feedbackNotes"]), arr(y["feedbackNotes"]))
        s["momentLiked"] = .obj(lww(obj(x["momentLiked"]), obj(y["momentLiked"]), tsA, tsB, { tsKey(liked: $0) }, { p, q, _ in .num(Swift.max(p.number ?? 0, q.number ?? 0)) }))
        s["mutedChannels"] = .obj(lww(obj(x["mutedChannels"]), obj(y["mutedChannels"]), tsA, tsB, { tsKey(muted: $0) }, { p, q, _ in cmp(p.string ?? "", q.string ?? "") >= 0 ? p : q }))
        s["feedTime"] = .obj(maxMap(obj(x["feedTime"]), obj(y["feedTime"])))
        var shown = obj(x["weekReviewShown"])
        for (k, v) in obj(y["weekReviewShown"]) { shown[k] = v }
        s["weekReviewShown"] = .obj(shown)
        s["plans"] = .obj(lww(obj(x["plans"]), obj(y["plans"]), tsA, tsB, { tsKey(plan: $0) }, combinePlan))
        s["settings"] = .obj(lww(obj(x["settings"]), obj(y["settings"]), tsA, tsB, { tsKey(setting: $0) }, pickSetting))
        if let npd = maxStr(x["notesPromptDay"], y["notesPromptDay"]) { s["notesPromptDay"] = npd }
        if let md = maxStr(x["momentDay"], y["momentDay"]) { s["momentDay"] = md }
        let ts = maxMap(obj(a["ts"]), obj(b["ts"]))
        return .obj(["v": .num(Double(version)), "state": .obj(s), "ts": .obj(ts)])
    }

    /// Gleiche Form wie nach einer Zusammenführung (Reihenfolge, Kürzungen), ohne Inhalt zu ändern
    static func normalized(_ d: J) -> J { merge(d, emptyDoc()) }
}
