import AVFoundation
import QuartzCore
import SwiftUI
import WebKit

/// Plays one moment: own stream (TED, SRF, Cybersight, MIT, podcasts) with AVPlayer, Beat via YouTube in a web view.
/// Stops exactly at the moment's end and reports progress and the current caption.
@MainActor
final class Playback: ObservableObject {
    let moment: Moment
    @Published private(set) var playing = false {
        didSet {
            // Punkt 1: Wisch bis erstes Bild, gemessen bis zum ersten Abspielen nach dem Wisch
            if playing, !oldValue, let t0 = measureT0 {
                measureT0 = nil
                onFirstFrame?(Int(((CACurrentMediaTime() - t0) * 1000).rounded()), measureBuffered)
            }
        }
    }
    @Published private(set) var buffering = true
    @Published private(set) var progress: Double = 0
    @Published private(set) var caption = ""
    @Published private(set) var ended = false

    var onEnded: (() -> Void)?
    var onFirstFrame: ((Int, Bool) -> Void)?
    private var measureT0: CFTimeInterval?
    private var measureBuffered = false

    /// Geladen und angehalten bereit, also gepuffert im Sinne der Messung.
    /// Eigener Stream: das Item ist abspielbereit. YouTube: der Player hat "ready" gemeldet.
    var isPreloaded: Bool {
        if let player { return player.currentItem?.status == .readyToPlay }
        return web != nil && webReady
    }
    private var webReady = false

    func startMeasure(buffered: Bool) {
        measureT0 = CACurrentMediaTime()
        measureBuffered = buffered
    }
    /// seconds of this moment actually played (for learning and feed time)
    private(set) var watched: Double = 0

    private(set) var player: AVPlayer?
    private(set) var web: WKWebView?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var itemObserver: NSKeyValueObservation?
    private var wantsPlay = false
    private var rate: Float = 1
    private var lastTime: Double?

    init(moment: Moment) {
        self.moment = moment
    }

    // MARK: Setup

    func prepare() {
        // Text-Momente haben keinen Player
        guard moment.feedForm != .text, player == nil && web == nil else { return }
        if moment.isYouTube { makeWeb() } else { makePlayer() }
    }

    private func makePlayer() {
        guard let s = moment.hls, let url = URL(string: s) else { return }
        let item = AVPlayerItem(url: url)
        item.preferredForwardBufferDuration = 20
        itemObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let msg = item.error?.localizedDescription ?? "unknown"
            DispatchQueue.main.async { Diag.log("stream failed \(self?.moment.id ?? "?"): \(msg)") }
        }
        let p = AVPlayer(playerItem: item)
        p.automaticallyWaitsToMinimizeStalling = true
        p.seek(to: CMTime(seconds: moment.start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        statusObserver = p.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let status = player.timeControlStatus
            DispatchQueue.main.async {
                guard let self else { return }
                self.playing = status == .playing
                self.buffering = status == .waitingToPlayAtSpecifiedRate
            }
        }
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.15, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t.seconds) }
        }
        player = p
    }

    private func makeWeb() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(WeakHandler(self), name: "core")
        let w = WKWebView(frame: .zero, configuration: config)
        w.isOpaque = false
        w.backgroundColor = .black
        w.scrollView.isScrollEnabled = false
        w.isUserInteractionEnabled = false
        w.loadHTMLString(Self.youTubeHTML(moment), baseURL: URL(string: "https://amrsaad.github.io"))
        web = w
    }

    // MARK: Control

    func play() {
        wantsPlay = true
        ended = false
        if let player {
            player.playImmediately(atRate: rate)
        } else {
            js("play()")
        }
    }

    func pause() {
        wantsPlay = false
        player?.pause()
        js("pause()")
    }

    func togglePlay() {
        if wantsPlay { pause() } else { play() }
    }

    var isPlayingWanted: Bool { wantsPlay }

    func setRate(_ r: Float) {
        // nie schneller als 2x (Fundament-Regel 11)
        let r = Float(Speed.clamp(Double(r)))
        rate = r
        if let player, wantsPlay { player.rate = r }
        js("rate(\(r))")
    }

    func restart() {
        ended = false
        watched = 0
        player?.seek(to: CMTime(seconds: moment.start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        js("restart()")
    }

    func teardown() {
        pause()
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        statusObserver = nil
        itemObserver = nil
        player?.replaceCurrentItem(with: nil)
        player = nil
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "core")
        web?.stopLoading()
        web = nil
    }

    private func js(_ code: String) {
        web?.evaluateJavaScript(code, completionHandler: nil)
    }

    // MARK: Progress

    fileprivate func tick(_ seconds: Double) {
        guard seconds.isFinite else { return }
        let rel = seconds - moment.start
        progress = min(1, max(0, rel / moment.duration))
        caption = moment.caption(at: rel)
        if let last = lastTime, playing || player == nil, seconds > last, seconds - last < 2 { watched += seconds - last }
        lastTime = seconds
        if wantsPlay && seconds >= moment.end - 0.25 && !ended { finish() }
    }

    private func finish() {
        ended = true
        pause()
        onEnded?()
    }

    fileprivate func handle(_ message: String) {
        if message == "ready" {
            webReady = true
            buffering = false
            if wantsPlay { js("play()") }
        } else if message.hasPrefix("error:") {
            Diag.log("youtube error \(moment.videoId): \(message.dropFirst(6))")
            buffering = false
        } else if message.hasPrefix("state:") {
            let st = Int(message.dropFirst(6)) ?? -1
            playing = st == 1
            buffering = st == 3 || st == -1
        } else if message.hasPrefix("time:"), let t = Double(message.dropFirst(5)) {
            tick(t)
        }
    }

    private static func youTubeHTML(_ m: Moment) -> String {
        let id = m.videoId.replacingOccurrences(of: "'", with: "")
        return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;background:#000;overflow:hidden;height:100%}
        #wrap{position:absolute;inset:0;overflow:hidden}
        #p{position:absolute;inset:0;width:100%;height:100%}</style></head>
        <body><div id="wrap"><div id="p"></div></div>
        <script>
        var player=null,want=false,r=1,START=\(m.start),END=\(m.end);
        function post(x){try{window.webkit.messageHandlers.core.postMessage(x)}catch(e){}}
        function onYouTubeIframeAPIReady(){
          player=new YT.Player('p',{videoId:'\(id)',host:'https://www.youtube-nocookie.com',
            playerVars:{playsinline:1,controls:0,rel:0,modestbranding:1,iv_load_policy:3,fs:0,disablekb:1,cc_load_policy:0,start:Math.floor(START),end:Math.ceil(END),autoplay:0},
            events:{onReady:function(){player.seekTo(START,true);player.pauseVideo();post('ready');if(want)play()},
                    onStateChange:function(e){post('state:'+e.data)},
                    onError:function(e){post('error:'+e.data)}}});
        }
        function play(){want=true;if(player&&player.playVideo){player.setPlaybackRate(r);player.playVideo()}}
        function pause(){want=false;if(player&&player.pauseVideo)player.pauseVideo()}
        function rate(x){r=x;if(player&&player.setPlaybackRate)player.setPlaybackRate(x)}
        function restart(){if(player&&player.seekTo)player.seekTo(START,true)}
        setInterval(function(){if(player&&player.getCurrentTime){post('time:'+player.getCurrentTime())}},200);
        </script>
        <script src="https://www.youtube.com/iframe_api"></script>
        </body></html>
        """
    }
}

/// Avoids a retain cycle between the web view and the playback object.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: Playback?
    init(_ target: Playback) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else { return }
        Task { @MainActor [weak target] in target?.handle(body) }
    }
}

// MARK: Views

/// Video as a 16:9 band (AVPlayerLayer, aspect fit).
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let v = LayerView()
        v.backgroundColor = .black
        v.playerLayer.videoGravity = .resizeAspect
        v.playerLayer.player = player
        v.isUserInteractionEnabled = false
        return v
    }

    func updateUIView(_ v: LayerView, context: Context) {
        if v.playerLayer.player !== player { v.playerLayer.player = player }
    }
}

struct WebHostView: UIViewRepresentable {
    let web: WKWebView
    func makeUIView(context: Context) -> WKWebView { web }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
