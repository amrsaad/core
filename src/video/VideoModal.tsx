import { useEffect, useRef, useState } from 'react';
import type { Video } from '../videoTypes';
import { createPlayer, loadYT, STATE, type YTPlayer } from './ytApi';

/** Einzelnes gespeichertes Video im Vollbild. Am Ende schließt es sich, damit kein YouTube-Endscreen erscheint. */
export function VideoModal({ video, onClose }: { video: Video; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let done = false;
    loadYT().then((YT) => {
      if (done || !host.current) return;
      const t = document.createElement('div');
      host.current.replaceChildren(t);
      player.current = createPlayer(YT, t, video.id, {
        onReady: () => {
          player.current?.unMute();
          player.current?.playVideo();
        },
        onState: (s) => {
          setPlaying(s === STATE.PLAYING);
          if (s === STATE.ENDED) close.current();
        },
      });
    });
    const poll = window.setInterval(() => {
      const p = player.current;
      const d = p?.getDuration?.() ?? 0;
      if (p && d > 1 && p.getCurrentTime() >= d - 0.4) {
        p.pauseVideo();
        close.current();
      }
    }, 200);
    return () => {
      done = true;
      window.clearInterval(poll);
      player.current?.destroy();
    };
  }, [video.id]);

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <div className="vframe">
        <div ref={host} />
      </div>
      {!playing && <img className="vposter" src={video.thumb} alt="" />}
      <div
        className="absolute inset-0 z-10"
        onClick={() => {
          const p = player.current;
          if (!p) return;
          p.unMute();
          if (p.getPlayerState() === STATE.PLAYING) p.pauseVideo();
          else p.playVideo();
        }}
      />
      <button onClick={onClose} className="absolute right-4 z-20 rounded-full bg-black/70 px-4 py-2 text-[15px] text-white" style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
        Schließen
      </button>
      <div className="vinfo pointer-events-none">
        <div className="vchannel text-[#B3B3B3]">{video.channelName}</div>
        <div className="vtitle text-white">{video.title}</div>
      </div>
    </div>
  );
}
