import { useEffect, useRef, useState } from 'react';
import { createPlayer, loadYT, STATE, type YTPlayer } from '../video/ytApi';
import { thumbOf, type Moment } from './types';

/** Gespeicherten Moment im Vollbild abspielen. Am Ende schließt er sich, damit kein YouTube-Endscreen erscheint. */
export function MomentModal({ moment, onClose }: { moment: Moment; onClose: () => void }) {
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
      player.current = createPlayer(YT, t, moment.videoId, {
        onReady: () => {
          player.current?.unMute();
          player.current?.loadVideoById({ videoId: moment.videoId, startSeconds: moment.start, endSeconds: moment.end });
        },
        onState: (s) => {
          setPlaying(s === STATE.PLAYING);
          if (s === STATE.ENDED) close.current();
        },
      });
    }).catch(() => {
      /* YouTube-API nicht erreichbar: das Vorschaubild bleibt, Schließen geht weiter */
    });
    const poll = window.setInterval(() => {
      const p = player.current;
      if (p && p.getPlayerState?.() === STATE.PLAYING && p.getCurrentTime() >= moment.end - 0.3) {
        p.pauseVideo();
        close.current();
      }
    }, 150);
    return () => {
      done = true;
      window.clearInterval(poll);
      player.current?.destroy();
    };
  }, [moment]);

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <div className="vframe">
        <div ref={host} />
      </div>
      {!playing && <img className="vposter" src={thumbOf(moment)} alt="" />}
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
        <div className="vchannel text-[#B3B3B3]">{moment.channel}</div>
        <div className="vtitle text-white">{moment.hook}</div>
      </div>
    </div>
  );
}
