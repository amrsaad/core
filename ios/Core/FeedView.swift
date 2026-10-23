import Combine
import SwiftUI

/// Loads the pool and builds the endless queue.
@MainActor
final class FeedModel: ObservableObject {
    enum Status: Equatable { case loading, ready, error(String) }

    @Published var status: Status = .loading
    @Published private(set) var queue: [Moment] = []
    private(set) var pool: [Moment] = []
    private(set) var updatedAt: String?
    private var cursor: Mix.Cursor?
    /// not published on purpose: created while views build
    private var playbacks: [String: Playback] = [:]

    func load(key: Data, store: Store) async {
        status = .loading
        do {
            let p = try await Vault.fetchPool(key: key)
            pool = p.moments
            updatedAt = p.updatedAt
            queue = []
            cursor = nil
            ensure(upTo: 6, store: store)
            status = .ready
        } catch {
            Diag.log("feed load error: \(error.localizedDescription)")
            status = .error(error.localizedDescription)
        }
    }

    func ensure(upTo n: Int, store: Store) {
        if cursor == nil { cursor = Mix.Cursor(firstOfDay: store.state.momentDay != Day.key()) }
        var added: [Moment] = []
        var c = cursor ?? Mix.Cursor(firstOfDay: false)
        while queue.count + added.count < n {
            guard let block = Mix.nextBlock(pool: pool, state: store.state, cursor: &c), !block.isEmpty else { break }
            added += block
        }
        cursor = c
        if !added.isEmpty { queue += added }
    }

    func removeUpcoming(channel: String, after index: Int) {
        guard index + 1 < queue.count else { return }
        queue = Array(queue[...index]) + queue[(index + 1)...].filter { $0.channel != channel }
    }

    func playback(for m: Moment) -> Playback {
        if let p = playbacks[m.id] { return p }
        let p = Playback(moment: m)
        playbacks[m.id] = p
        return p
    }

    /// Keeps players only near the current position (memory, network).
    func prune(around index: Int) {
        let keep = Set(queue.indices.filter { abs($0 - index) <= 2 }.map { queue[$0].id })
        for (id, p) in playbacks where !keep.contains(id) {
            p.teardown()
            playbacks[id] = nil
        }
    }

    func current(_ id: String?) -> Playback? { id.flatMap { playbacks[$0] } }
}

struct FeedView: View {
    @ObservedObject var feed: FeedModel
    @EnvironmentObject var store: Store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var currentID: String?
    @State private var lastID: String?
    @State private var forYou: Moment?
    @State private var flash: String?
    @State private var menuFor: Moment?
    @State private var feedSeconds: Double = 0
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            switch feed.status {
            case .loading:
                Color.black.overlay(ProgressView().tint(.white))
            case .error(let msg):
                message("\(msg) The first start needs internet.")
            case .ready:
                if feed.queue.isEmpty {
                    message("You have seen every moment. New ones arrive with the next daily run.")
                } else {
                    pager
                }
            }
        }
        .background(Color.black)
        .onReceive(ticker) { _ in countTime() }
        .onDisappear { feed.current(currentID)?.pause() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { feed.current(currentID)?.pause() } else if forYou == nil { feed.current(currentID)?.play() }
        }
    }

    /// Pages are exactly as tall as the scroll view (full screen, under status bar and tab bar),
    /// otherwise paging and page size drift apart by the tab bar height.
    private var pager: some View {
        GeometryReader { geo in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(feed.queue) { m in
                        MomentPage(
                            moment: m,
                            playback: feed.playback(for: m),
                            isActive: currentID == m.id,
                            insets: geo.safeAreaInsets,
                            flash: $flash,
                            onMenuAction: { action in menu(action, m) },
                            onMenu: { Diag.log("menu open \(m.id)"); menuFor = m }
                        )
                        .frame(width: geo.size.width, height: geo.size.height)
                        .id(m.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $currentID)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .overlay {
            if let m = forYou { ForYouOverlay(moment: m) { advance() } }
        }
        .overlay(alignment: .center) {
            if let flash {
                Text(flash)
                    .font(.system(size: 15, weight: .semibold))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.black.opacity(0.8), in: Capsule())
                    .transition(.opacity)
            }
        }
        .sheet(item: $menuFor) { m in
            MenuSheet(moment: m, captions: Binding(get: { store.state.captions }, set: { store.state.captions = $0 })) { action in
                menuFor = nil
                switch action {
                case .full:
                    feed.playback(for: m).pause()
                    if let url = m.fullURL { openURL(url) }
                case .more, .known, .weak, .wrong, .mute:
                    menu(action, m)
                }
            }
        }
        .onAppear {
            if currentID == nil { currentID = feed.queue.first?.id }
            if forYou == nil { activate(currentID) }
        }
        .onChange(of: currentID) { old, new in
            leave(old, to: new)
            activate(new)
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 17))
            .foregroundStyle(Palette.secondary)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(Color.black)
    }

    // MARK: Flow

    private func index(of id: String?) -> Int? { id.flatMap { i in feed.queue.firstIndex { $0.id == i } } }

    private func activate(_ id: String?) {
        guard let id, let i = index(of: id) else { return }
        forYou = nil
        let m = feed.queue[i]
        let p = feed.playback(for: m)
        p.prepare()
        p.onEnded = { finished(m) }
        if p.ended { p.restart() }
        p.play()
        store.markSeen(m)
        feed.ensure(upTo: i + 5, store: store)
        for j in [i + 1, i + 2] where j < feed.queue.count { feed.playback(for: feed.queue[j]).prepare() }
        feed.prune(around: i)
        lastID = id
    }

    private func leave(_ old: String?, to new: String?) {
        guard let old, let oi = index(of: old) else { return }
        let m = feed.queue[oi]
        let p = feed.playback(for: m)
        p.pause()
        p.setRate(1)
        let ni = index(of: new) ?? oi
        if ni > oi && !p.ended {
            if let f = Mix.leaveSignal(watched: p.watched, duration: m.duration) { store.signal(m, f) }
            store.log(m, watched: p.watched)
        }
        if ni < oi, let new, let target = feed.queue.first(where: { $0.id == new }) {
            store.signal(target, Mix.Signal.back)
        }
    }

    private func finished(_ m: Moment) {
        guard currentID == m.id else { return }
        store.log(m, watched: feed.playback(for: m).watched, ended: true)
        store.signal(m, Mix.Signal.ended)
        if m.forYou != nil {
            withAnimation(.easeOut(duration: 0.2)) { forYou = m }
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { if forYou?.id == m.id { advance() } }
        } else {
            advance()
        }
    }

    private func advance() {
        forYou = nil
        guard let i = index(of: currentID), i + 1 < feed.queue.count else { return }
        withAnimation(.easeInOut(duration: 0.25)) { currentID = feed.queue[i + 1].id }
    }

    private func menu(_ action: MenuAction, _ m: Moment) {
        switch action {
        case .more:
            store.signal(m, Mix.Signal.more)
            store.log(m, watched: feed.playback(for: m).watched, feedback: "more")
            show("More like this")
        case .known, .weak, .wrong:
            store.signal(m, Mix.Signal.negative)
            store.log(m, watched: feed.playback(for: m).watched, feedback: action.rawValue)
            show(action == .known ? "Already known" : action == .weak ? "Weak" : "Wrong")
            advance()
        case .mute:
            store.mute(m)
            if let i = index(of: m.id) { feed.removeUpcoming(channel: m.channel, after: i) }
            show("\(m.speakerLine) muted")
            advance()
        case .full:
            break
        }
    }

    private func show(_ text: String) {
        withAnimation { flash = text }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { withAnimation { flash = nil } }
    }

    private func countTime() {
        guard scenePhase == .active, let p = feed.current(currentID), p.playing else { return }
        feedSeconds += 1
        if feedSeconds >= 10 {
            store.addFeedTime(feedSeconds)
            feedSeconds = 0
        }
    }
}

enum MenuAction: String { case more, known, weak, wrong, mute, full }

// MARK: One moment

struct MomentPage: View {
    let moment: Moment
    @ObservedObject var playback: Playback
    let isActive: Bool
    let insets: EdgeInsets
    @Binding var flash: String?
    let onMenuAction: (MenuAction) -> Void
    let onMenu: () -> Void
    @EnvironmentObject var store: Store
    @State private var fast = false
    @State private var pressing = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let bandH = w * 9 / 16
            let bandY = h * 0.31
            ZStack(alignment: .topLeading) {
                gestureLayer

                if moment.isAudio {
                    AsyncImage(url: moment.thumbURL) { img in img.resizable().scaledToFill() } placeholder: { Palette.band }
                        .frame(width: min(w * 0.62, 240), height: min(w * 0.62, 240))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .position(x: w / 2, y: h * 0.165 + min(w * 0.62, 240) / 2)
                        .allowsHitTesting(false)
                } else {
                    media(width: w, height: bandH)
                        .frame(width: w, height: bandH)
                        .clipped()
                        .offset(y: bandY)
                        .allowsHitTesting(false)
                }

                if store.state.captions && !playback.caption.isEmpty {
                    if moment.isAudio {
                        Text(playback.caption)
                            .font(.system(size: 24, weight: .semibold))
                            .multilineTextAlignment(.center)
                            .shadow(color: .black.opacity(0.8), radius: 3, y: 1)
                            .frame(width: w - 48)
                            .position(x: w / 2, y: h * 0.56)
                            .allowsHitTesting(false)
                    } else {
                        Text(playback.caption)
                            .font(.system(size: 17, weight: .semibold))
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 8))
                            .frame(maxWidth: w - 104, alignment: .leading)
                            .offset(x: 16, y: bandY + bandH + 16)
                            .allowsHitTesting(false)
                    }
                }

                VStack(spacing: 0) {
                    progressLine
                    Spacer()
                    HStack(alignment: .bottom, spacing: 0) {
                        info
                        Spacer(minLength: 16)
                        actions
                    }
                    .padding(.leading, 16)
                    .padding(.trailing, 12)
                    .padding(.bottom, insets.bottom + 12)
                }
                .padding(.top, insets.top)

                if fast {
                    Text("2x")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(.black.opacity(0.7), in: Capsule())
                        .position(x: w / 2, y: insets.top + 28)
                }
            }
            .foregroundStyle(.white)
        }
        .onAppear { playback.prepare() }
    }

    @ViewBuilder
    private func media(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            Palette.band
            if let player = playback.player {
                PlayerLayerView(player: player)
            } else if let web = playback.web {
                WebHostView(web: web)
            }
            if !(isActive && playback.playing) {
                AsyncImage(url: moment.thumbURL) { img in img.resizable().scaledToFill() } placeholder: { Palette.band }
                    .frame(width: width, height: height)
                    .clipped()
                    .allowsHitTesting(false)
            }
        }
    }

    private var progressLine: some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(.white.opacity(0.18))
            if isActive && playback.buffering && !playback.playing {
                LoadingBar(color: moment.area.color)
            } else {
                Rectangle().fill(moment.area.color).scaleEffect(x: playback.progress, y: 1, anchor: .leading)
            }
        }
        .frame(height: 2)
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle().fill(moment.area.color).frame(width: 8, height: 8)
                Text(moment.area.label).foregroundStyle(moment.area.color).fontWeight(.semibold)
                Text(moment.speakerLine).foregroundStyle(Palette.secondary).lineLimit(1)
            }
            .font(.system(size: 13))
            Text(moment.hook)
                .font(.system(size: 17, weight: .semibold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
    }

    private var actions: some View {
        let saved = store.isSaved(moment)
        return VStack(spacing: 20) {
            ActionButton(icon: saved ? "bookmark.fill" : "bookmark", label: saved ? "Saved" : "Save") {
                Diag.log("save button \(moment.id)")
                if saved { store.unsave(moment); flashText("Removed") } else { store.save(moment); flashText("Saved") }
            }
            ActionButton(icon: "plus", label: "More like this") { onMenuAction(.more) }
            ActionButton(icon: "arrow.up.right", label: moment.isAudio ? "Full episode" : "Full video") {
                playback.pause()
                if let url = moment.fullURL { openURL(url) }
            }
            ActionButton(icon: "ellipsis", label: "More") { onMenu() }
                .accessibilityIdentifier("menuButton")
        }
        .frame(width: 64)
    }

    /// Tap: pause and play. Double tap: save. Hold: 2x speed.
    private var gestureLayer: some View {
        Color.black
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                if !store.isSaved(moment) { store.save(moment) }
                flashText("Saved")
            }
            .onTapGesture { playback.togglePlay() }
            .onLongPressGesture(minimumDuration: 0.35, maximumDistance: 12, perform: {}, onPressingChanged: { down in
                pressing = down
                if down {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        if pressing { fast = true; playback.setRate(2) }
                    }
                } else if fast {
                    fast = false
                    playback.setRate(1)
                }
            })
    }

    private func flashText(_ t: String) {
        withAnimation { flash = t }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { withAnimation { flash = nil } }
    }
}

/// Menu of one moment. Lives at feed level, because one sheet per page does not work in SwiftUI.
struct MenuSheet: View {
    let moment: Moment
    @Binding var captions: Bool
    let onAction: (MenuAction) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Circle().fill(moment.area.color).frame(width: 8, height: 8)
                Text(moment.speakerLine).foregroundStyle(Palette.secondary)
            }
            .font(.system(size: 13))
            .padding(.bottom, 8)
            row("More like this", .more)
            row("Already know this", .known)
            row("Weak", .weak)
            row("Wrong", .wrong)
            row(moment.isAudio ? "Open full episode" : "Open full video", .full)
            row("Mute this channel", .mute)
            Toggle("Captions", isOn: $captions)
                .font(.system(size: 17))
                .frame(height: 52)
            Button { dismiss() } label: {
                Text("Cancel").font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 52)
            }
            .background(Palette.button, in: RoundedRectangle(cornerRadius: 12))
            .padding(.top, 8)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .accessibilityIdentifier("menuSheet")
        .presentationDetents([.medium])
        .presentationBackground(Palette.surface)
        .presentationDragIndicator(.visible)
    }

    private func row(_ title: String, _ action: MenuAction) -> some View {
        Button { onAction(action) } label: {
            Text(title).font(.system(size: 17)).frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.line).frame(height: 1) }
    }
}

struct ActionButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 26, weight: .regular)).frame(height: 30)
                Text(label).font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(minWidth: 56, minHeight: 44)
            .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct LoadingBar: View {
    let color: Color
    @State private var x: CGFloat = -0.3

    var body: some View {
        GeometryReader { g in
            Rectangle().fill(color)
                .frame(width: g.size.width * 0.3)
                .offset(x: g.size.width * x)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: false)) { x = 1 }
                }
        }
        .clipped()
    }
}

struct ForYouOverlay: View {
    let moment: Moment
    let onNext: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    Circle().fill(moment.area.color).frame(width: 8, height: 8)
                    Text("FOR YOU").font(.system(size: 12, weight: .semibold)).tracking(1).foregroundStyle(moment.area.color)
                }
                Text(moment.forYou ?? "")
                    .font(.system(size: 26, weight: .medium))
                    .lineSpacing(6)
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 28)
            .frame(maxHeight: .infinity, alignment: .center)
            VStack {
                Spacer()
                HStack {
                    Text("Tap to continue")
                    Spacer()
                    Text("6 s")
                }
                .font(.system(size: 13))
                .foregroundStyle(Palette.tertiary)
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onNext)
    }
}
