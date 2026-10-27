import Combine
import SwiftUI
import UIKit

/// Loads the pool and builds the endless queue.
@MainActor
final class FeedModel: ObservableObject {
    enum Status: Equatable { case loading, ready, error(String) }

    @Published var status: Status = .loading
    /// Caption offen: das Blättern der Momente ruht, damit der Zug nach unten die Caption schließt
    @Published var captionOpen = false
    @Published private(set) var queue: [Moment] = []
    /// Der ganze Pool. Gespielt wird nur der Teil, den der Filter durchlässt (formPool).
    private(set) var pool: [Moment] = []
    private(set) var form: FeedForm = .video
    private(set) var updatedAt: String?
    private var cursor: Mix.Cursor?
    /// not published on purpose: created while views build
    private var playbacks: [String: Playback] = [:]

    var formPool: [Moment] { pool.filter { $0.feedForm == form } }
    var formPoolEmpty: Bool { status == .ready && formPool.isEmpty && !pool.isEmpty }

    /// Filterwechsel: Spieler abbauen, Warteschlange aus dem gefilterten Pool neu mischen. Gewichte und Gesehenes bleiben im Store.
    func applyForm(_ f: FeedForm, store: Store) {
        guard f != form else { return }
        form = f
        for p in playbacks.values { p.teardown() }
        playbacks = [:]
        queue = []
        cursor = nil
        ensure(upTo: 6, store: store)
    }

    func load(key: Data, store: Store) async {
        status = .loading
        do {
            let p = try await Vault.fetchPool(key: key)
            pool = p.moments
            form = store.state.currentForm
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
            guard let block = Mix.nextBlock(pool: formPool, state: store.state, cursor: &c), !block.isEmpty else { break }
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
    /// Aufgabe 5: Rückmeldungsblatt (Menü "Note" oder Langdruck auf das Herz)
    @State private var noteFor: Moment?
    @State private var feedSeconds: Double = 0
    // Punkt 5: Abrufkarte nach jedem 4. Moment
    @State private var recallCard: (moment: Moment, review: Bool)?
    @State private var sessionSeen = 0
    @State private var counted: Set<String> = []
    @State private var recent: [Recall.Recent] = []
    /// Punkt 3: Textende erreicht (dann erst "gesehen")
    @State private var textSeen: Set<String> = []
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            switch feed.status {
            case .loading:
                Color.black.overlay(ProgressView().tint(.white))
            case .error(let msg):
                message("\(msg) The first start needs internet.")
            case .ready:
                if feed.formPoolEmpty {
                    message(FormFilter.emptyLine(feed.form))
                        .overlay(alignment: .top) { FeedTopBar().padding(.top, 6) }
                } else if feed.queue.isEmpty {
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
            if phase != .active { feed.current(currentID)?.pause() } else if forYou == nil && recallCard == nil && store.state.currentForm != .text { feed.current(currentID)?.play() }
        }
        .onChange(of: store.state.form) { _, _ in
            // Filterwechsel: neue Warteschlange nur aus passenden Momenten, Wiedergabe beginnt beim ersten
            forYou = nil
            feed.applyForm(store.state.currentForm, store: store)
            let first = feed.queue.first?.id
            if first == currentID { activate(first) } else { currentID = first }
        }
    }

    /// Pages are exactly as tall as the scroll view (full screen, under status bar and tab bar),
    /// otherwise paging and page size drift apart by the tab bar height.
    private var pager: some View {
        GeometryReader { geo in
            // geo respects the safe area, so its insets are real; the scroll view and pages take the full screen
            let full = CGSize(width: geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing,
                              height: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(feed.queue) { m in
                        MomentPage(
                            moment: m,
                            playback: feed.playback(for: m),
                            isActive: currentID == m.id,
                            insets: geo.safeAreaInsets,
                            flash: $flash,
                            onMenu: { Diag.log("menu open \(m.id)"); menuFor = m },
                            onNote: { Diag.log("note open \(m.id)"); noteFor = m },
                            onTextEnd: { textEnd(m) },
                            onNext: { advance() },
                            onCaption: { feed.captionOpen = $0 }
                        )
                        .frame(width: full.width, height: full.height)
                        .id(m.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollDisabled(feed.captionOpen)
            .scrollPosition(id: $currentID)
            .ignoresSafeArea()
        }
        .overlay(alignment: .top) {
            if forYou == nil && recallCard == nil { FeedTopBar().padding(.top, 6) }
        }
        .overlay {
            if let m = forYou { ForYouOverlay(moment: m) { advance() } }
        }
        .overlay {
            if let r = recallCard {
                RecallCardView(moment: r.moment, review: r.review, onAnswer: { got in store.answerRecall(r.moment, got: got) }, onClose: { closeRecall() })
                    .id(r.moment.id + String(r.review))
            }
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
        .sheet(item: $noteFor) { m in
            NoteSheetView(moment: m, initial: store.state.notes?[m.id]) { chips, text in
                noteFor = nil
                sendNote(m, chips: chips, text: text)
            }
        }
        .sheet(item: $menuFor) { m in
            MenuSheet(moment: m, captions: Binding(get: { store.captionsShown(m) }, set: { store.state.captionMode = $0 ? .on : .off })) { action in
                menuFor = nil
                menu(action, m)
            }
        }
        .onAppear {
            if currentID == nil { currentID = feed.queue.first?.id }
            if forYou == nil { activate(currentID) }
        }
        .onChange(of: currentID) { old, new in
            leave(old, to: new)
            activate(new, measure: true)
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

    private func activate(_ id: String?, measure: Bool = false) {
        guard let id, let i = index(of: id) else { return }
        forYou = nil
        let m = feed.queue[i]
        let p = feed.playback(for: m)
        let preloaded = p.isPreloaded
        p.prepare()
        p.onEnded = { finished(m) }
        p.onFirstFrame = { ms, buffered in store.addLatency(ms: ms, buffered: buffered) }
        if p.ended { p.restart() }
        p.setRate(Float(store.state.speed))
        let text = store.state.currentForm == .text
        if text || recallCard != nil {
            p.pause()
        } else {
            if measure { p.startMeasure(buffered: preloaded) }
            p.play()
        }
        if !text { store.markSeen(m) }
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
        p.setRate(Float(store.state.speed))
        let ni = index(of: new) ?? oi
        let text = store.state.currentForm == .text
        // Im Textmodus gibt es keine Wiedergabezeit, darum kein Zeitsignal
        if ni > oi && !p.ended && !text {
            if let f = Mix.leaveSignal(watched: p.watched, duration: m.duration) { store.signal(m, f) }
            store.log(m, watched: p.watched)
        }
        // Punkt 5: geschauter Anteil des verlassenen Moments, Karte nach jedem 4.
        if ni > oi && !counted.contains(m.id) {
            counted.insert(m.id)
            let watched = p.ended ? 1 : text ? (textSeen.contains(m.id) ? 1 : 0) : min(1, max(0, p.watched / m.duration))
            recent = Array((recent + [Recall.Recent(id: m.id, watched: watched)]).suffix(8))
            sessionSeen += 1
            if Recall.cardDue(sessionSeen),
               let pick = Recall.pick(store.state.recall ?? [:], recent: recent, now: Date(), available: { findMoment($0)?.recall != nil }),
               let rm = findMoment(pick.id) {
                recallCard = (rm, pick.review)
            }
        }
        if ni < oi, let new, let target = feed.queue.first(where: { $0.id == new }) {
            store.signal(target, Mix.Signal.back)
        }
    }

    private func findMoment(_ id: String) -> Moment? {
        store.state.saved[id]?.moment ?? feed.pool.first { $0.id == id }
    }

    private func closeRecall() {
        recallCard = nil
        if store.state.currentForm != .text, scenePhase == .active { feed.current(currentID)?.play() }
    }

    private func textEnd(_ m: Moment) {
        guard currentID == m.id, store.state.currentForm == .text, !textSeen.contains(m.id) else { return }
        textSeen.insert(m.id)
        store.markSeen(m)
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

    /// Known und Weak bestätigen sich durch das Schließen des Menüs, Wrong und Mute zusätzlich mit Toast
    private func menu(_ action: MenuAction, _ m: Moment) {
        switch action {
        case .known, .weak, .wrong:
            store.signal(m, Mix.Signal.negative)
            store.log(m, watched: feed.playback(for: m).watched, feedback: action.rawValue)
            let kind: Actions.Kind = action == .wrong ? .wrong : action == .weak ? .weak : .known
            if Actions.toast(kind) { show("Wrong") }
            advance()
        case .note:
            // das Menü schließt zuerst, dann geht das Blatt auf
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { noteFor = m }
        case .mute:
            store.mute(m)
            if let i = index(of: m.id) { feed.removeUpcoming(channel: m.channel, after: i) }
            if Actions.toast(.mute) { show("\(m.speakerLine) muted") }
            advance()
        }
    }

    /// Rückmeldung: lokal speichern, Known und Wrong wirken wie im Menü, dann die vorbereitete Issue-Seite im Browser öffnen
    private func sendNote(_ m: Moment, chips: [String], text: String) {
        let ctx = Note.Context(
            id: m.id, videoId: m.videoId, start: m.start, end: m.end, channel: m.channel,
            sourceUrl: m.fullURL?.absoluteString ?? "", area: m.area.label, tab: store.state.currentForm.label,
            speed: store.state.speed, device: Diag.deviceLine, commit: Diag.commit, hook: m.hook)
        let address = Note.url(ctx, chips: chips, text: text)
        store.saveNote(m, chips: chips, text: text)
        if Env.isTest { Diag.log("note url \(address)") }
        // Im UI-Test bleibt die App im Vordergrund
        if !Env.isTest, let url = URL(string: address) { openURL(url) }
        switch Note.effect(chips) {
        case .wrong: menu(.wrong, m)
        case .known: menu(.known, m)
        case nil: break
        }
    }

    private func show(_ text: String) {
        Diag.log("toast \(text)")
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

enum MenuAction: String { case known, weak, wrong, note, mute }

// MARK: One moment

struct MomentPage: View {
    let moment: Moment
    @ObservedObject var playback: Playback
    let isActive: Bool
    let insets: EdgeInsets
    @Binding var flash: String?
    let onMenu: () -> Void
    let onNote: () -> Void
    let onTextEnd: () -> Void
    let onNext: () -> Void
    let onCaption: (Bool) -> Void
    @EnvironmentObject var store: Store
    @State private var fast = false
    @State private var pressing = false
    /// Herz an der Tippstelle (400 ms) und Bestätigung der Quelle am Knopf (150 ms)
    @State private var heart: (point: CGPoint, id: Int)?
    @State private var heartVisible = false
    @State private var sourceBounce = 0
    /// Aufgeklappte Caption: Hook, excerpt, Sprecher, Folge, Stelle. Der Ton läuft weiter.
    @State private var captionOpen = false
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

                if store.captionsShown(moment) && !playback.caption.isEmpty {
                    let ar = Captions.isArabic(playback.caption)
                    if moment.isAudio {
                        CaptionText(text: playback.caption, big: true)
                            .multilineTextAlignment(.center)
                            .shadow(color: .black.opacity(0.8), radius: 3, y: 1)
                            .frame(width: w - 48)
                            .position(x: w / 2, y: h * 0.56)
                            .allowsHitTesting(false)
                    } else {
                        CaptionText(text: playback.caption, big: store.state.currentForm == .audio)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 8))
                            .frame(width: w - 104, alignment: ar ? .trailing : .leading)
                            .offset(x: 16, y: bandY + bandH + 16)
                            .allowsHitTesting(false)
                    }
                }

                if isActive && store.state.currentForm == .text {
                    TextPanel(moment: moment, insets: insets, onEnd: onTextEnd, onNext: onNext, onDouble: { like(double: true, at: $0) })
                        .frame(width: w, height: h)
                }

                VStack(spacing: 0) {
                    progressLine
                    Spacer()
                    HStack(alignment: .bottom, spacing: 0) {
                        if store.state.currentForm != .text { info } else { Spacer(minLength: 16) }
                        actions
                    }
                    .padding(.leading, 16)
                    .padding(.trailing, 12)
                    .padding(.bottom, insets.bottom + 12)
                }
                .padding(.top, insets.top)

                if let heart {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 96))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.5), radius: 8, y: 2)
                        .scaleEffect(heartVisible ? 1.0 : 0.5)
                        .opacity(heartVisible ? 1 : 0)
                        .position(heart.point)
                        .id(heart.id)
                        .allowsHitTesting(false)
                        .accessibilityIdentifier("heartBurst")
                        .onAppear { withAnimation(.easeOut(duration: 0.12)) { heartVisible = true } }
                }

                if captionOpen && isActive && store.state.currentForm != .text {
                    CaptionSheetView(moment: moment, onClose: { captionOpen = false })
                        .frame(width: w, height: h)
                        .transition(.move(edge: .bottom))
                }

                if fast {
                    Text("2x")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(.black.opacity(0.7), in: Capsule())
                        .position(x: w / 2, y: insets.top + 28)
                }
            }
            .foregroundStyle(.white)
            .coordinateSpace(name: "page")
        }
        .onAppear { playback.prepare() }
        .onChange(of: isActive) { _, a in if !a { captionOpen = false } }
        .onChange(of: captionOpen) { _, v in onCaption(v) }
        .animation(.easeOut(duration: 0.2), value: captionOpen)
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
            .accessibilityIdentifier("speakerLine")
            HookText(hook: moment.hook)
        }
        .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { openCaption() }
    }

    private func openCaption() {
        captionOpen = true
        let p0 = playback.playing
        Diag.log("caption open playing=\(p0)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { if captionOpen { Diag.log("caption still playing=\(playback.playing)") } }
    }

    private var actions: some View {
        let saved = store.isSaved(moment)
        let liked = store.isLiked(moment)
        return VStack(spacing: 22) {
            ActionButton(icon: liked ? "heart.fill" : "heart", label: "More", bounce: liked ? 1 : 0, id: "like", value: liked ? "on" : "off", onLong: onNote) {
                let t0 = CACurrentMediaTime()
                like(double: false)
                measure(since: t0)
            }
            ActionButton(icon: saved ? "bookmark.fill" : "bookmark", label: "Save", bounce: saved ? 1 : 0, id: "save", value: saved ? "on" : "off") {
                let t0 = CACurrentMediaTime()
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                Diag.log("save button \(moment.id)")
                if saved { store.unsave(moment) } else { store.save(moment) }
                measure(since: t0)
            }
            ActionButton(icon: "arrow.up.right", label: "Source", bounce: sourceBounce, id: "source") {
                sourceBounce += 1
                playback.pause()
                if let url = moment.fullURL { openURL(url) }
            }
            ActionButton(icon: "ellipsis", label: "", bounce: 0, id: "menuButton", accessibility: "Options") { onMenu() }
        }
        .frame(width: 64)
    }

    /// More like this. Doppeltipp setzt nur (Herz an der Tippstelle), der Knopf schaltet um.
    private func like(double: Bool, at point: CGPoint? = nil) {
        let was = store.isLiked(moment)
        let on = Actions.nextLiked(was, double: double)
        if let point { showHeart(point) }
        guard on != was else { return }
        UIImpactFeedbackGenerator(style: on ? .medium : .light).impactOccurred()
        store.setLiked(moment, on)
        if on { store.log(moment, watched: playback.watched, feedback: "more") }
    }

    private func showHeart(_ p: CGPoint) {
        let id = (heart?.id ?? 0) + 1
        Diag.log("heart \(Int(p.x)),\(Int(p.y))")
        heart = (p, id)
        heartVisible = false
        DispatchQueue.main.asyncAfter(deadline: .now() + Actions.heartSeconds) {
            if heart?.id == id { withAnimation(.easeOut(duration: 0.1)) { heartVisible = false }; heart = nil }
        }
    }

    /// Tipp bis Füllung: bis zum nächsten Bildaufbau, Anzeige in Settings unter Player
    private func measure(since t0: CFTimeInterval) {
        NextFrame.after { shown in
            store.addTap(ms: max(0, Int(((shown - t0) * 1000).rounded())))
        }
    }

    /// Tap: pause and play. Double tap: More like this with a heart. Hold: 2x speed.
    /// The surface leaves out the action column, otherwise its tap gestures swallow the buttons' taps.
    private var gestureLayer: some View {
        HStack(spacing: 0) {
            gestureSurface
            VStack(spacing: 0) {
                gestureSurface
                Color.black
                    .frame(height: actionsHeight + insets.bottom + 12)
                    .allowsHitTesting(false)
            }
            .frame(width: 88)
        }
    }

    private var actionsHeight: CGFloat { 4 * 48 + 3 * 22 + 16 }

    private var gestureSurface: some View {
        Color.black
            .contentShape(Rectangle())
            .gesture(SpatialTapGesture(count: 2, coordinateSpace: .named("page")).onEnded { v in like(double: true, at: v.location) })
            .onTapGesture { playback.togglePlay() }
            .onLongPressGesture(minimumDuration: 0.35, maximumDistance: 12, perform: {}, onPressingChanged: { down in
                pressing = down
                if down {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        if pressing { fast = true; playback.setRate(Float(Speed.hold)) }
                    }
                } else if fast {
                    fast = false
                    playback.setRate(Float(store.state.speed))
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
            row("Known", .known)
            row("Weak", .weak)
            row("Wrong", .wrong)
            row("Note", .note)
            row("Mute speaker", .mute)
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

/// Ziel 48 pt. Die Füllung wechselt ohne Verzögerung, der Sprung dauert etwa 150 ms.
struct ActionButton: View {
    let icon: String
    let label: String
    var bounce: Int = 0
    var id: String = ""
    var accessibility: String? = nil
    var value: String? = nil
    /// Langdruck (nur das Herz): öffnet die Rückmeldung, der Tipp danach bleibt aus
    var onLong: (() -> Void)? = nil
    let action: () -> Void
    @State private var longFired = false

    var body: some View {
        Button(action: { if longFired { longFired = false } else { action() } }) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 26, weight: .regular))
                    .frame(height: 30)
                    .symbolEffect(.bounce, options: .speed(3), value: bounce)
                if !label.isEmpty { Text(label).font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.8) }
            }
            .frame(minWidth: Actions.targetPt, minHeight: Actions.targetPt)
            .contentShape(Rectangle())
            .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(LongPressGesture(minimumDuration: Note.longPressSeconds).onEnded { _ in
            longFired = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onLong?()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { longFired = false }
        }, including: onLong == nil ? .none : .all)
        .accessibilityLabel(accessibility ?? label)
        .accessibilityValue(value ?? "")
        .accessibilityIdentifier(id)
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
