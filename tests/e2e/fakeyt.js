// Nachbau der YouTube IFrame API für E2E-Tests. Zeitraffer: 10 Video-Sekunden pro 100 ms.
window.__ytlog = [];
window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, Player: function (el, opts) {
  // Wie die echte API bei ungültiger ID: der Konstruktor wirft (IDs mit Anfang throwvid)
  if (/^throwvid/.test(opts.videoId || '')) throw new Error('Invalid video id. (nachgebaut)');
  const ev = opts.events; let vid = opts.videoId, t = 0, endAt = Infinity, st = -1, muted = true, timer = null;
  const f = document.createElement('div');
  f.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font:18px sans-serif;background:#123';
  el.replaceWith(f);
  f.__player = this;
  const paint = () => { f.textContent = `${vid} t=${t.toFixed(0)} state ${st}${muted ? ' stumm' : ' TON'}`; };
  const set = (s) => { st = s; paint(); ev.onStateChange && ev.onStateChange({ data: s }); };
  const arg = (a) => (typeof a === 'string' ? { videoId: a } : a);
  // Wie bei YouTube: Zustandswechsel kommt erst nach dem Start, ein pauseVideo im Callback stoppt den Lauf
  const play = () => { clearInterval(timer); timer = setInterval(() => { t += window.__ytSlow ? 0.1 : 10; paint(); if (t >= endAt) { clearInterval(timer); t = endAt; set(0); } }, 100); set(1); };
  this.loadVideoById = (a) => {
    a = arg(a); vid = a.videoId; t = a.startSeconds ?? 0; endAt = a.endSeconds ?? 600; window.__ytlog.push('load ' + vid + ' ' + t + '-' + endAt);
    // Wie YouTube bei gesperrten oder gelöschten Videos: Fehler 150 statt Wiedergabe (IDs mit Anfang errorvid)
    if (/^errorvid/.test(vid)) { st = -1; paint(); setTimeout(() => ev.onError && ev.onError({ data: 150 }), 20); return; }
    play();
  };
  this.cueVideoById = (a) => { a = arg(a); vid = a.videoId; t = a.startSeconds ?? 0; endAt = a.endSeconds ?? 600; clearInterval(timer); window.__ytlog.push('cue ' + vid); set(5); };
  this.playVideo = () => play();
  this.pauseVideo = () => { clearInterval(timer); if (st === 1) set(2); };
  this.mute = () => { muted = true; paint(); }; this.unMute = () => { muted = false; window.__ytlog.push('unmute'); paint(); }; this.isMuted = () => muted;
  this.getCurrentTime = () => t; this.getDuration = () => 600; this.getPlayerState = () => st; this.seekTo = (s) => { t = s; }; this.setPlaybackRate = (r) => { window.__ytlog.push('rate ' + r); };
  // Lautheit (Entscheidung 16): YouTube kann nur absenken, der Test liest die Lautstärke aus dem Protokoll
  this.setVolume = (v) => { window.__ytlog.push('volume ' + v); };
  this.destroy = () => clearInterval(timer);
  // Nur für Tests: Zustand erzwingen (Puffern, Cue, Pause, Ende), ohne Zeitraffer anzuhalten oder zu starten
  this.__force = (s) => { if (s !== 1) clearInterval(timer); set(s); };
  setTimeout(() => ev.onReady && ev.onReady(), 30);
}};
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
// Eigene Streams (hls) laufen im Runner nicht: das <video>-Element verhält sich wie die nachgebaute API (gleicher Zeitraffer, kein Netz).
(() => {
  const P = HTMLMediaElement.prototype;
  // Kann schon früh eingebaut sein (background.mjs): dann nicht ein zweites Mal, sonst laufen die alten Zeitgeber weiter
  if (P.__fake) return;
  P.__fake = true;
  const timers = new WeakMap();
  const emit = (el, n) => el.dispatchEvent(new Event(n));
  const def = (k, d) => Object.defineProperty(P, k, { configurable: true, ...d });
  def('currentTime', { get() { return this.__t || 0; }, set(v) { this.__t = v; } });
  def('paused', { get() { return this.__p !== false; } });
  def('ended', { get() { return !!this.__e; } });
  def('duration', { get() { return 600; } });
  // Tempo ebenfalls nachgebaut: ein echtes playbackRate auf einem Element ohne Medium bringt WebKit im Runner bei aktiver Media Session zum Absturz
  def('playbackRate', { get() { return this.__pr ?? 1; }, set(v) { this.__pr = v; } });
  def('defaultPlaybackRate', { get() { return this.__dpr ?? 1; }, set(v) { this.__dpr = v; } });
  def('src', { get() { return this.__src || ''; }, set(v) { this.__src = v; } });
  // Wie die Spezifikation: load() hält ein laufendes Element an (paused wird true), ohne pause-Ereignis
  P.load = function () { clearInterval(timers.get(this)); this.__p = true; setTimeout(() => emit(this, 'loadedmetadata'), 20); };
  P.play = function () {
    clearInterval(timers.get(this));
    this.__p = false; this.__e = false;
    timers.set(this, setInterval(() => { this.__t = (this.__t || 0) + (window.__ytSlow ? 0.1 : 10); emit(this, 'timeupdate'); }, 100));
    emit(this, 'playing');
    return Promise.resolve();
  };
  P.pause = function () { clearInterval(timers.get(this)); if (this.__p === false) { this.__p = true; emit(this, 'pause'); } };
})();
