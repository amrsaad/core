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
        // Der QR-Code eines anderen Geräts trägt das Sync-Token mit
        if let token = Vault.token(fromLink: s, key: key) { Vault.saveToken(token) }
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
                    Text("Player").font(.system(size: 17, weight: .semibold))
                    HStack {
                        Text("Captions").font(.system(size: 17))
                        Spacer()
                        Picker("Captions", selection: Binding(get: { store.state.captionMode ?? .auto }, set: { store.state.captionMode = $0 })) {
                            ForEach(CaptionMode.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .accessibilityIdentifier("captionMode")
                    }
                    Text("Auto: on for audio and Arabic moments, off for English video.").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                    HStack {
                        Text("Playback speed").font(.system(size: 17))
                        Spacer()
                        Picker("Playback speed", selection: Binding(get: { store.state.speed }, set: { store.state.playbackSpeed = $0 })) {
                            ForEach(Speed.options, id: \.self) { v in Text(v == 1 ? "1x" : "1.5x").tag(v) }
                        }
                        .accessibilityIdentifier("speed")
                    }
                    Text("Hold the video for 2x. Never faster than 2x.").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                    LatencyView(samples: store.state.playLatency ?? [])
                    Text("Moments skipped: \(feed.skipped)")
                        .font(.system(size: 13)).foregroundStyle(Palette.secondary)
                        .accessibilityIdentifier("momentsSkipped")
                    TapReactionView(samples: store.state.tapMs ?? [])
                }

                card { SyncCard() }

                card { UnlockDeviceCard(key: Vault.loadKey()) }

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

                card {
                    Text("This build").font(.system(size: 17, weight: .semibold))
                    Text("Version \(Diag.version), commit \(Diag.commit)")
                        .font(.system(size: 13)).foregroundStyle(Palette.secondary)
                    if let until = Diag.expiresAt {
                        let days = max(0, Int(ceil(until.timeIntervalSinceNow / 86400)))
                        Text(days == 0 ? "Expired. Reinstall from the Mac." : "Works for \(days) more \(days == 1 ? "day" : "days"), then reinstall from the Mac.")
                            .font(.system(size: 13)).foregroundStyle(days <= 1 ? Color(hex: 0xE07B7B) : Palette.secondary)
                    }
                    Button("Copy diagnostics") {
                        UIPasteboard.general.string = Diag.text(poolCount: feed.pool.count, poolUpdated: feed.updatedAt, skipped: feed.skipped, state: store.state)
                        note = "Copied. Paste it into the chat."
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Area.brain.color)
                    .accessibilityIdentifier("copyDiagnostics")
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

// MARK: Weekly review (Punkt 7, R13, R14, R16)

/// Feste Reihenfolge: Plan der Vorwoche mit "Did it happen?", gespeicherte Momente abhaken, Zahlen zur Aufgabe,
/// genau ein Plan "When …, I will …". "Skip this week" geht immer. Kein Lob, kein Vergleich.
struct WeeklyReviewView: View {
    @EnvironmentObject var store: Store
    let onDone: () -> Void
    @State private var when = ""
    @State private var will = ""

    var body: some View {
        let since = Date().addingTimeInterval(-7 * 86_400)
        let items = store.state.saved.values.filter { $0.savedAt >= since }.sorted { $0.savedAt < $1.savedAt }
        let prevKey = Store.prevWeekKey()
        let prev = store.state.plans?[prevKey]
        let task = store.weekTask()
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Your week").font(.system(size: 28, weight: .bold)).padding(.top, 24)

                if let prev {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("LAST WEEK'S PLAN").font(.system(size: 12)).tracking(1).foregroundStyle(Palette.tertiary)
                        Text("When \(prev.when), I will \(prev.will).").font(.system(size: 17)).fixedSize(horizontal: false, vertical: true)
                        Text("Did it happen?").font(.system(size: 15)).foregroundStyle(Palette.secondary)
                        HStack(spacing: 8) {
                            answer("Yes", true, prev, prevKey)
                            answer("No", false, prev, prevKey)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("prevPlan")
                }

                Text("Saved moments. Check off what you applied.").font(.system(size: 15)).foregroundStyle(Palette.secondary)
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

                Text("This week: \(WeekReview.line(seen: task.seen, gotIt: task.gotIt, applied: task.applied))")
                    .font(.system(size: 17))
                    .accessibilityIdentifier("weekLine")

                VStack(alignment: .leading, spacing: 10) {
                    Text("ONE PLAN FOR NEXT WEEK").font(.system(size: 12)).tracking(1).foregroundStyle(Palette.tertiary)
                    Text("When …").font(.system(size: 15)).foregroundStyle(Palette.secondary)
                    field("I finish the OCT clinic on Tuesday", $when, id: "planWhen")
                    Text("I will …").font(.system(size: 15)).foregroundStyle(Palette.secondary)
                    field("explain one saved moment to a colleague", $will, id: "planWill")
                }
                .padding(16)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))

                Button { close(save: true) } label: {
                    Text("Save plan and continue").font(.system(size: 17, weight: .semibold)).foregroundStyle(.black).frame(maxWidth: .infinity, minHeight: 52)
                }
                .background(Color.white.opacity(WeekReview.planComplete(when: when, will: will) ? 1 : 0.4), in: RoundedRectangle(cornerRadius: 12))
                .disabled(!WeekReview.planComplete(when: when, will: will))
                .accessibilityIdentifier("savePlan")
                Button("Skip this week") { close(save: false) }
                    .font(.system(size: 15)).foregroundStyle(Palette.secondary).frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
        .onAppear {
            let mine = store.state.plans?[Day.weekKey()]
            when = mine?.when ?? ""
            will = mine?.will ?? ""
        }
    }

    private func field(_ placeholder: String, _ text: Binding<String>, id: String) -> some View {
        TextField(placeholder, text: text)
            .textInputAutocapitalization(.never)
            .font(.system(size: 17))
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .background(Color(hex: 0x111111), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x333333)))
            .accessibilityIdentifier(id)
    }

    private func answer(_ title: String, _ value: Bool, _ prev: WeekPlan, _ key: String) -> some View {
        let on = prev.happened == value
        return Button {
            var p = prev
            p.happened = value
            store.state.plans?[key] = p
        } label: {
            Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(on ? Color.black : Color.white).frame(maxWidth: .infinity, minHeight: 48)
        }
        .background(on ? Color.white : Color.clear, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Color.white : Color(hex: 0x3A3D45)))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func close(save: Bool) {
        store.state.weekReviewShown[Day.weekKey()] = true
        if save {
            var plans = store.state.plans ?? [:]
            plans[Day.weekKey()] = WeekPlan(when: when.trimmingCharacters(in: .whitespaces), will: will.trimmingCharacters(in: .whitespaces))
            store.state.plans = plans
        }
        onDone()
    }
}
