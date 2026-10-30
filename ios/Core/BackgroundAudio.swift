import AVFoundation
import Combine
import MediaPlayer
import UIKit

// MARK: Rules (pure, covered by BackgroundTests)

/// Entscheidung 13 (core-content/docs/fundament.md): what happens when the app leaves the foreground,
/// when a moment ends there and when "seen" counts. Nothing here touches UI, so the unit tests cover it.
enum BackgroundPolicy {
    enum LeaveAction: Equatable {
        /// Own stream: the sound continues. The video layer is detached by PlayerLayerView, the AVPlayer stays.
        case keepSound
        /// YouTube and text: nothing plays in the background.
        case pause
    }

    enum EndAction: Equatable { case advance, stop }

    static func onLeave(form: FeedForm, isYouTube: Bool) -> LeaveAction {
        if isYouTube || form == .text { return .pause }
        return .keepSound
    }

    /// Audio tab: next moment of the mix, like a swipe. Video tab in the background: stop after the moment.
    /// In the foreground nothing changes (the feed advances as before).
    static func atEnd(form: FeedForm, inBackground: Bool) -> EndAction {
        if !inBackground { return .advance }
        return form == .audio ? .advance : .stop
    }

    /// Foreground: "seen" at the start of the moment, as before. Background: only at ended.
    static func countsSeenAtStart(inBackground: Bool) -> Bool { !inBackground }
}

/// Counts the end of a moment once, so returning to the foreground never counts it a second time.
struct EndLedger {
    private var ended: Set<String> = []

    /// true only the first time this moment ends
    mutating func first(_ id: String) -> Bool { ended.insert(id).inserted }
}

/// The neighbor in the queue. The swipe, the lock screen buttons and the automatic advance all use this one function.
enum QueueStep {
    static func next(in queue: [Moment], after id: String?) -> Moment? {
        guard let id, let i = queue.firstIndex(where: { $0.id == id }), i + 1 < queue.count else { return nil }
        return queue[i + 1]
    }

    static func previous(in queue: [Moment], before id: String?) -> Moment? {
        guard let id, let i = queue.firstIndex(where: { $0.id == id }), i > 0 else { return nil }
        return queue[i - 1]
    }
}

enum AppPhase {
    /// Real background only. Launch and short interruptions (.inactive) count as foreground.
    @MainActor static var inBackground: Bool { UIApplication.shared.applicationState == .background }
}

// MARK: Audio session

/// Keeps the audio session active only while something plays. Between two moments it stays on for a few seconds,
/// so the automatic advance in the background never loses the session (an idle background app is suspended).
@MainActor
final class AudioSessionGate {
    static let shared = AudioSessionGate()
    static let idleSeconds = 3.0

    private var wanted = Set<String>()
    private var isActive = false
    private var idleWork: DispatchWorkItem?

    func want(_ id: String, _ on: Bool) {
        if on { wanted.insert(id) } else { wanted.remove(id) }
        if !wanted.isEmpty {
            idleWork?.cancel()
            idleWork = nil
            activate()
        } else if isActive, idleWork == nil {
            let work = DispatchWorkItem { [weak self] in
                MainActor.assumeIsolated { self?.deactivateIfIdle() }
            }
            idleWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.idleSeconds, execute: work)
        }
    }

    private func activate() {
        guard !isActive else { return }
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playback, mode: .moviePlayback)
            try s.setActive(true)
            isActive = true
            Diag.log("bg: session on")
        } catch {
            Diag.log("bg: session error \(error.localizedDescription)")
        }
    }

    private func deactivateIfIdle() {
        idleWork = nil
        guard wanted.isEmpty, isActive else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            isActive = false
            Diag.log("bg: session off")
        } catch {
            Diag.log("bg: session off failed \(error.localizedDescription)")
        }
    }
}

// MARK: Lock screen

enum RemoteCommand { case play, pause, toggle, next, previous, save }

/// Remote command handlers run on an arbitrary queue, so they hop to the main thread here.
private func remoteSend(_ cmd: RemoteCommand) {
    DispatchQueue.main.async {
        MainActor.assumeIsolated { NowPlaying.shared.run(cmd) }
    }
}

/// UIImage in a closure that is created outside any actor, because the system calls the handler on its own queue.
private func makeArtwork(_ img: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: img.size) { _ in img }
}

/// Now Playing card and remote commands: title = hook, subtitle = channel, cover = thumbnail.
@MainActor
final class NowPlaying {
    static let shared = NowPlaying()

    struct Handlers {
        var play: () -> Void
        var pause: () -> Void
        var toggle: () -> Void
        var next: () -> Void
        var previous: () -> Void
        var save: () -> Void
    }

    var handlers: Handlers?
    private var installed = false
    private var moment: Moment?
    private var playback: Playback?
    private var form: FeedForm = .video
    private var saved = false
    private var bag = Set<AnyCancellable>()
    private var artwork: MPMediaItemArtwork?
    private var artworkID: String?
    private var resumeAfterInterruption = false

    func install() {
        guard !installed else { return }
        installed = true
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { _ in remoteSend(.play); return .success }
        c.pauseCommand.addTarget { _ in remoteSend(.pause); return .success }
        c.togglePlayPauseCommand.addTarget { _ in remoteSend(.toggle); return .success }
        c.nextTrackCommand.addTarget { _ in remoteSend(.next); return .success }
        c.previousTrackCommand.addTarget { _ in remoteSend(.previous); return .success }
        // Save über den Like-Command. Zeigt ihn die Oberfläche nicht, passiert nichts.
        c.likeCommand.localizedTitle = "Save"
        c.likeCommand.localizedShortTitle = "Save"
        c.likeCommand.addTarget { _ in remoteSend(.save); return .success }
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { n in
            let type = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            let options = (n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init(rawValue:))
            MainActor.assumeIsolated { NowPlaying.shared.interruption(type, options) }
        }
    }

    func run(_ cmd: RemoteCommand) {
        guard let h = handlers else { return }
        Diag.log("bg: remote \(cmd)")
        switch cmd {
        case .play: h.play()
        case .pause: h.pause()
        case .toggle: h.toggle()
        case .next: h.next()
        case .previous: h.previous()
        case .save: h.save()
        }
    }

    /// A moment with an own stream became the current one.
    func attach(moment m: Moment, playback p: Playback, form: FeedForm, saved: Bool) {
        install()
        if moment?.id != m.id {
            artwork = nil
            artworkID = nil
            loadArtwork(m)
        }
        moment = m
        playback = p
        self.form = form
        self.saved = saved
        bag.removeAll()
        p.$playing
            .receive(on: DispatchQueue.main)
            .sink { [weak self] on in MainActor.assumeIsolated { self?.refresh(playing: on) } }
            .store(in: &bag)
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.isEnabled = true
        c.pauseCommand.isEnabled = true
        c.togglePlayPauseCommand.isEnabled = true
        // Next and previous only in the audio tab. The video tab plays the running moment to its end and stops.
        c.nextTrackCommand.isEnabled = form == .audio
        c.previousTrackCommand.isEnabled = form == .audio
        c.likeCommand.isEnabled = true
        c.likeCommand.isActive = saved
        refresh(playing: p.playing)
    }

    func setSaved(_ on: Bool) {
        saved = on
        MPRemoteCommandCenter.shared().likeCommand.isActive = on
    }

    /// YouTube, text or nothing current: no card.
    func clear() {
        bag.removeAll()
        moment = nil
        playback = nil
        guard installed else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
        let c = MPRemoteCommandCenter.shared()
        c.nextTrackCommand.isEnabled = false
        c.previousTrackCommand.isEnabled = false
    }

    private func refresh(playing: Bool) {
        guard let m = moment, let p = playback else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: m.hook,
            MPMediaItemPropertyArtist: m.speakerLine,
            MPMediaItemPropertyAlbumTitle: m.area.label,
            MPMediaItemPropertyPlaybackDuration: m.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: p.ended ? m.duration : p.progress * m.duration,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? Double(p.rate) : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let art = artwork, artworkID == m.id { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }

    private func loadArtwork(_ m: Moment) {
        guard let url = m.thumbURL else { return }
        let id = m.id
        Task { [weak self] in
            guard let (data, _) = try? await URLSession.shared.data(from: url), let img = UIImage(data: data) else { return }
            guard let self, self.moment?.id == id else { return }
            self.artwork = makeArtwork(img)
            self.artworkID = id
            self.refresh(playing: self.playback?.playing ?? false)
        }
    }

    fileprivate func interruption(_ type: AVAudioSession.InterruptionType?, _ options: AVAudioSession.InterruptionOptions?) {
        switch type {
        case .began:
            resumeAfterInterruption = playback?.isPlayingWanted ?? false
            Diag.log("bg: interrupted")
            if resumeAfterInterruption { handlers?.pause() }
        case .ended:
            let should = options?.contains(.shouldResume) ?? false
            Diag.log("bg: interruption over, resume \(should && resumeAfterInterruption)")
            if should && resumeAfterInterruption { handlers?.play() }
            resumeAfterInterruption = false
        default:
            break
        }
    }
}
