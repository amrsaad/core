import SwiftUI
import UIKit

// MARK: Unlock

struct UnlockView: View {
    let onUnlock: (Data) -> Void
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 6) {
                ForEach(Area.allCases, id: \.self) { a in Circle().fill(a.color).frame(width: 8, height: 8) }
            }
            Text("Core").font(.system(size: 28, weight: .bold))
            Text("Core is not unlocked on this phone yet. Copy your unlock link, then paste it here.")
                .font(.system(size: 17))
                .foregroundStyle(Palette.secondary)
            Button {
                tryUnlock(UIPasteboard.general.string ?? "")
            } label: {
                Text("Paste link").font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 52)
            }
            .background(Palette.button, in: RoundedRectangle(cornerRadius: 12))
            Text("Or paste it here").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
            TextField("https://…", text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.line))
                .onSubmit { tryUnlock(text) }
            if !text.isEmpty {
                Button("Unlock") { tryUnlock(text) }
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            if let error { Text(error).font(.system(size: 15)).foregroundStyle(Color(hex: 0xE07B7B)) }
        }
        .foregroundStyle(.white)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
    }

    private func tryUnlock(_ s: String) {
        guard let key = Vault.key(fromLink: s) else {
            error = "That is not a valid unlock link. Please paste the whole link."
            return
        }
        Vault.saveKey(key)
        onUnlock(key)
    }
}

// MARK: Saved

struct SavedView: View {
    @EnvironmentObject var store: Store
    @Environment(\.openURL) private var openURL

    var body: some View {
        let items = store.state.saved.values.sorted { $0.savedAt > $1.savedAt }
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Saved").font(.system(size: 28, weight: .bold)).padding(.top, 16)
                Text(items.count == 1 ? "1 moment" : "\(items.count) moments").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                if items.isEmpty {
                    Text("Double tap a moment to save it here.").font(.system(size: 17)).foregroundStyle(Palette.secondary).padding(.top, 16)
                }
                ForEach(items) { s in
                    SavedRow(item: s, open: { if let u = s.moment.fullURL { openURL(u) } }, remove: { store.unsave(s.moment) })
                }
            }
            .padding(16)
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
    }
}

struct SavedRow: View {
    let item: SavedMoment
    let open: () -> Void
    let remove: () -> Void

    var body: some View {
        let m = item.moment
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: m.thumbURL) { img in img.resizable().scaledToFill() } placeholder: { Palette.band }
                .frame(width: 96, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(m.area.color).frame(width: 6, height: 6)
                    Text(m.area.label).foregroundStyle(m.area.color).fontWeight(.semibold)
                    Text(m.speakerLine + (item.done ? " · applied" : "")).foregroundStyle(Palette.tertiary).lineLimit(1)
                }
                .font(.system(size: 12))
                Text(m.hook).font(.system(size: 15, weight: .semibold))
                if let f = m.forYou { Text(f).font(.system(size: 14)).foregroundStyle(Palette.secondary) }
                HStack(spacing: 16) {
                    Button(m.isAudio ? "Full episode" : "Full video", action: open)
                    Button("Remove", action: remove)
                }
                .font(.system(size: 13))
                .foregroundStyle(Palette.secondary)
                .padding(.top, 4)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: Settings

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var feed: FeedModel
    let onRelock: () -> Void
    @State private var note: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Settings").font(.system(size: 28, weight: .bold)).padding(.top, 16)

                card {
                    HStack {
                        Text("Time in Core").font(.system(size: 17, weight: .semibold))
                        Spacer()
                        Text("minutes per day").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                    }
                    TimeBars(feedTime: store.state.feedTime)
                }

                card {
                    Text("Learned").font(.system(size: 17, weight: .semibold))
                    LearnedView(weights: store.state.weights)
                    Button("Reset what Core learned") {
                        store.state.weights = Weights()
                        note = "Learned weights reset."
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Area.brain.color)
                }

                card {
                    Text("Mix").font(.system(size: 17, weight: .semibold))
                    HStack(spacing: 0) {
                        ForEach(Area.allCases, id: \.self) { a in Rectangle().fill(a.color) }
                    }
                    .frame(height: 8)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    HStack {
                        ForEach(Area.allCases, id: \.self) { a in
                            Text("\(a.label) \(Int(((store.state.areaShares[a.rawValue] ?? 0) * 100).rounded())) %")
                            if a != .beat { Spacer() }
                        }
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.secondary)
                    Text("Core learns from what you watch, skip and save. Every area keeps at least 10 %.")
                        .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                }

                card {
                    Toggle("Captions", isOn: Binding(get: { store.state.captions }, set: { store.state.captions = $0 }))
                        .font(.system(size: 17))
                }

                if !store.state.muted.isEmpty {
                    card {
                        Text("Muted channels").font(.system(size: 17, weight: .semibold))
                        ForEach(store.state.muted.keys.sorted(), id: \.self) { ch in
                            HStack {
                                Text(ch).font(.system(size: 15))
                                Spacer()
                                Button("Show again") { store.state.muted[ch] = nil }.font(.system(size: 13))
                            }
                        }
                    }
                }

                card {
                    let pool = feed.pool
                    Text("Pool").font(.system(size: 17, weight: .semibold))
                    Text("\(pool.count) moments · \(pool.filter { store.state.seen[$0.id] == nil }.count) unseen · saved \(store.state.saved.count)")
                        .font(.system(size: 13)).foregroundStyle(Palette.secondary)
                    Button("Unlock with a new link") { onRelock() }
                        .font(.system(size: 13))
                        .foregroundStyle(Palette.secondary)
                }

                if let note { Text(note).font(.system(size: 13)).foregroundStyle(Palette.tertiary) }
            }
            .padding(16)
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
    }

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct TimeBars: View {
    let feedTime: [String: Double]

    var body: some View {
        let cal = Calendar.current
        let days: [(String, Int, Bool)] = (0..<7).map { i in
            let d = cal.date(byAdding: .day, value: i - 6, to: Date()) ?? Date()
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US")
            f.dateFormat = "EEE"
            return (f.string(from: d), Int(((feedTime[Day.key(d)] ?? 0) / 60).rounded()), i == 6)
        }
        let maxMin = max(1, days.map { $0.1 }.max() ?? 1)
        return HStack(alignment: .bottom, spacing: 8) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, d in
                VStack(spacing: 4) {
                    Text("\(d.1)").font(.system(size: 11)).foregroundStyle(Palette.secondary)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(d.2 ? Color.white : Color(hex: 0x5A5F68))
                        .frame(height: max(2, CGFloat(d.1) / CGFloat(maxMin) * 60))
                    Text(d.0).font(.system(size: 11)).foregroundStyle(Palette.tertiary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 100, alignment: .bottom)
    }
}

struct LearnedView: View {
    let weights: Weights

    var body: some View {
        let all = Array(weights.topic) + Array(weights.channel)
        let up = all.filter { $0.value > 1.001 }.sorted { $0.value > $1.value }.prefix(5)
        let down = all.filter { $0.value < 0.999 }.sorted { $0.value < $1.value }.prefix(5)
        let fmt: (Double) -> String = { v in "\(v > 1 ? "+" : "")\(Int(((v - 1) * 100).rounded())) %" }
        return VStack(alignment: .leading, spacing: 4) {
            if all.isEmpty {
                Text("Nothing learned yet. Core learns from watching, swiping, saving and More like this.")
                    .foregroundStyle(Palette.tertiary)
            }
            if !up.isEmpty { Text("More: " + up.map { "\($0.key) \(fmt($0.value))" }.joined(separator: ", ")).foregroundStyle(Palette.secondary) }
            if !down.isEmpty { Text("Less: " + down.map { "\($0.key) \(fmt($0.value))" }.joined(separator: ", ")).foregroundStyle(Palette.tertiary) }
        }
        .font(.system(size: 13))
    }
}

// MARK: Weekly review

struct WeeklyReviewView: View {
    @EnvironmentObject var store: Store
    let onDone: () -> Void

    var body: some View {
        let weekStart = Calendar(identifier: .iso8601).date(from: Calendar(identifier: .iso8601).dateComponents([.yearForWeekOfYear, .weekOfYear], from: Date())) ?? Date()
        let items = store.state.saved.values.filter { $0.savedAt >= weekStart }.sorted { $0.savedAt > $1.savedAt }
        let minutes = Int(((0..<7).compactMap { i -> Double? in
            let d = Calendar.current.date(byAdding: .day, value: -i, to: Date()) ?? Date()
            return store.state.feedTime[Day.key(d)]
        }.reduce(0, +) / 60).rounded())
        VStack(alignment: .leading, spacing: 16) {
            Text("Sunday · this week").font(.system(size: 13)).foregroundStyle(Palette.tertiary).padding(.top, 24)
            Text("What did you apply?").font(.system(size: 28, weight: .bold))
            Text("Check off what you used this week.").font(.system(size: 15)).foregroundStyle(Palette.secondary)
            ScrollView {
                VStack(spacing: 8) {
                    if items.isEmpty { Text("Nothing saved this week.").foregroundStyle(Palette.secondary) }
                    ForEach(items) { s in
                        Button {
                            store.state.saved[s.id]?.done.toggle()
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: s.done ? "checkmark.square.fill" : "square").font(.system(size: 22))
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 6) {
                                        Circle().fill(s.moment.area.color).frame(width: 6, height: 6)
                                        Text(s.moment.area.label).foregroundStyle(s.moment.area.color).fontWeight(.semibold)
                                    }
                                    .font(.system(size: 12))
                                    Text(s.moment.hook).font(.system(size: 15, weight: .semibold)).multilineTextAlignment(.leading)
                                }
                                Spacer()
                            }
                            .padding(14)
                            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Text("Time in Core this week: \(minutes) min").font(.system(size: 13)).foregroundStyle(Palette.tertiary).frame(maxWidth: .infinity)
            Button {
                store.state.weekReviewShown[Day.weekKey()] = true
                onDone()
            } label: {
                Text("Continue to feed").font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 52)
            }
            .background(Palette.button, in: RoundedRectangle(cornerRadius: 12))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .background(Color.black.ignoresSafeArea())
    }
}
