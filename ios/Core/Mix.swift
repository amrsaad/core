import Foundation

/// Order of the feed, same rules as the web app (konzept.md):
/// blocks of 3 from one area, areas in equal thirds, the day starts with Beat,
/// learned weights per area, channel and topic within limits, 20 % new, top moments rare.
enum Mix {
    static let block = 3
    static let minShare = 0.1
    static let explore = 0.2
    static let topRate = 1.0 / 15
    static let wMin = 0.2
    static let wMax = 3.0

    enum Signal {
        static let ended = 1.1
        static let skip = 0.9
        static let early = 0.95
        static let mostly = 1.05
        static let back = 1.1
        static let more = 1.3
        static let save = 1.1
        static let negative = 0.7
    }

    static func clamp(_ w: Double) -> Double { min(wMax, max(wMin, (w * 10000).rounded() / 10000)) }

    static func applySignal(_ w: Weights, _ m: Moment, _ factor: Double) -> Weights {
        var out = w
        out.area[m.area.rawValue] = clamp((w.area[m.area.rawValue] ?? 1) * factor.squareRoot())
        out.channel[m.channel] = clamp((w.channel[m.channel] ?? 1) * factor)
        out.topic[m.topic] = clamp((w.topic[m.topic] ?? 1) * factor)
        return out
    }

    /// Signal when swiping away, by share watched. nil = neutral.
    static func leaveSignal(watched: Double, duration: Double) -> Double? {
        if watched < 5 { return Signal.skip }
        let f = watched / max(1, duration)
        if f < 0.3 { return Signal.early }
        if f >= 0.8 { return Signal.mostly }
        return nil
    }

    static func effectiveShares(_ shares: [String: Double], _ w: Weights, areas: [Area]) -> [Area: Double] {
        var out: [Area: Double] = [:]
        for a in areas { out[a] = max(0, shares[a.rawValue] ?? 0) * (w.area[a.rawValue] ?? 1) }
        let sum = out.values.reduce(0, +)
        for a in areas { out[a] = sum > 0 ? out[a]! / sum : 1.0 / Double(areas.count) }
        for _ in 0..<3 {
            let low = areas.filter { out[$0]! < minShare }
            if low.isEmpty { break }
            let free = 1 - Double(low.count) * minShare
            let highSum = areas.filter { !low.contains($0) }.map { out[$0]! }.reduce(0, +)
            for a in areas { out[a] = low.contains(a) ? minShare : (highSum > 0 ? out[a]! / highSum * free : free) }
        }
        return out
    }

    struct Cursor {
        var counts: [Area: Int] = [.brain: 0, .body: 0, .beat: 0]
        var firstOfDay: Bool
        var used = Set<String>()
        var sinceTop = 15
    }

    private static func known(_ w: Weights, _ m: Moment) -> Bool { w.channel[m.channel] != nil || w.topic[m.topic] != nil }
    private static func score(_ w: Weights, _ m: Moment) -> Double { (w.channel[m.channel] ?? 1) * (w.topic[m.topic] ?? 1) }

    /// Next block. Changes the cursor. nil when nothing is left.
    static func nextBlock(pool: [Moment], state: AppState, cursor c: inout Cursor) -> [Moment]? {
        let w = state.weights
        let free = pool.filter { state.seen[$0.id] == nil && !c.used.contains($0.id) && state.muted[$0.channel] == nil }
        if free.isEmpty { return nil }
        let areas = Area.allCases.filter { a in free.contains { $0.area == a } }
        let total = c.counts.values.reduce(0, +)
        var area: Area
        if c.firstOfDay && total == 0 && areas.contains(.beat) {
            area = .beat
        } else {
            let shares = effectiveShares(state.areaShares, w, areas: areas)
            area = areas.max { a, b in
                (shares[a]! * Double(total + 1) - Double(c.counts[a] ?? 0)) < (shares[b]! * Double(total + 1) - Double(c.counts[b] ?? 0))
            } ?? areas[0]
        }
        let inArea = free.filter { $0.area == area }
        var block: [Moment] = []
        for _ in 0..<Mix.block {
            let avail = inArea.filter { m in !block.contains(where: { $0.id == m.id }) }
            if avail.isEmpty { break }
            let tops = avail.filter { $0.top == true }
            let normal = avail.filter { $0.top != true }
            var pick: Moment?
            if !tops.isEmpty && Double(c.sinceTop) >= 1 / topRate && Double.random(in: 0..<1) < topRate * 2 {
                pick = tops.randomElement()
            }
            if pick == nil {
                let pool2 = normal.isEmpty ? avail : normal
                let fresh = pool2.filter { !known(w, $0) }
                let positive = pool2.filter { known(w, $0) && score(w, $0) >= 1 }
                let fromNew = !fresh.isEmpty && (Double.random(in: 0..<1) < explore || positive.isEmpty)
                let cands = fromNew ? fresh : (positive.isEmpty ? pool2 : positive)
                let weighted = cands.map { m in (m, score(w, m) * (block.contains { $0.channel == m.channel } ? 0.3 : 1)) }
                var r = Double.random(in: 0..<1) * weighted.map { $0.1 }.reduce(0, +)
                pick = weighted.last?.0
                for (m, wt) in weighted {
                    r -= wt
                    if r <= 0 { pick = m; break }
                }
            }
            guard let chosen = pick else { break }
            c.sinceTop = chosen.top == true ? 0 : c.sinceTop + 1
            block.append(chosen)
        }
        c.counts[area, default: 0] += 1
        for m in block { c.used.insert(m.id) }
        return block
    }
}
