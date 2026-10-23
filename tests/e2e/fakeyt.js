// Nachbau der YouTube IFrame API für E2E-Tests. Zeitraffer: 10 Video-Sekunden pro 100 ms.
window.__ytlog = [];
window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, Player: function (el, opts) {
  const ev = opts.events; let vid = opts.videoId, t = 0, endAt = Infinity, st = -1, muted = true, timer = null;
  const f = document.createElement('div');
  f.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font:18px sans-serif;background:#123';
  el.replaceWith(f);
  const paint = () => { f.textContent = `${vid} t=${t.toFixed(0)} state ${st}${muted ? ' stumm' : ' TON'}`; };
  const set = (s) => { st = s; paint(); ev.onStateChange && ev.onStateChange({ data: s }); };
  const arg = (a) => (typeof a === 'string' ? { videoId: a } : a);
  // Wie bei YouTube: Zustandswechsel kommt erst nach dem Start, ein pauseVideo im Callback stoppt den Lauf
  const play = () => { clearInterval(timer); timer = setInterval(() => { t += 10; paint(); if (t >= endAt) { clearInterval(timer); t = endAt; set(0); } }, 100); set(1); };
  this.loadVideoById = (a) => { a = arg(a); vid = a.videoId; t = a.startSeconds ?? 0; endAt = a.endSeconds ?? 600; window.__ytlog.push('load ' + vid + ' ' + t + '-' + endAt); play(); };
  this.cueVideoById = (a) => { a = arg(a); vid = a.videoId; t = a.startSeconds ?? 0; endAt = a.endSeconds ?? 600; clearInterval(timer); window.__ytlog.push('cue ' + vid); set(5); };
  this.playVideo = () => play();
  this.pauseVideo = () => { clearInterval(timer); if (st === 1) set(2); };
  this.mute = () => { muted = true; paint(); }; this.unMute = () => { muted = false; window.__ytlog.push('unmute'); paint(); }; this.isMuted = () => muted;
  this.getCurrentTime = () => t; this.getDuration = () => 600; this.getPlayerState = () => st; this.seekTo = (s) => { t = s; }; this.setPlaybackRate = () => {};
  this.destroy = () => clearInterval(timer);
  setTimeout(() => ev.onReady && ev.onReady(), 30);
}};
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
