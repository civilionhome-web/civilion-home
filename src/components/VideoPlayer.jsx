import { useEffect, useRef, useState } from 'react';

// Plays a site camera. Three kinds:
//  hls   – a .m3u8 live stream (from MediaMTX, a camera cloud service, etc.)
//  embed – a page made for embedding (YouTube Live unlisted, camera cloud player)
//  image – a snapshot image link that the camera refreshes; reloaded every 10 s
export default function VideoPlayer({ camera, onFullscreenRef }) {
  const box = useRef(null);
  const video = useRef(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (onFullscreenRef) onFullscreenRef.current = () => box.current?.requestFullscreen?.();
  }, [onFullscreenRef]);

  useEffect(() => {
    setErr('');
    if (!camera || camera.stream_type !== 'hls') return;
    const el = video.current;
    let hls;
    let cancelled = false;
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = camera.url; // Safari / iPhone play HLS natively
      el.play().catch(() => {});
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) { setErr('This browser cannot play the live stream.'); return; }
        hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true });
        hls.loadSource(camera.url);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setErr('The camera is offline right now. Please try again in a few minutes.');
        });
      });
    }
    return () => { cancelled = true; if (hls) hls.destroy(); el.removeAttribute('src'); el.load(); };
  }, [camera]);

  useEffect(() => {
    if (camera?.stream_type !== 'image') return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [camera]);

  if (!camera) {
    return <div className="video-box" ref={box}><div className="overlay-msg">No camera has been set up for this site yet.</div></div>;
  }

  const sep = camera.url.includes('?') ? '&' : '?';
  return (
    <div className="video-box" ref={box}>
      {camera.stream_type === 'hls' && <video ref={video} muted playsInline controls autoPlay />}
      {camera.stream_type === 'embed' && (
        <iframe src={camera.url} title={`Live camera: ${camera.name}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
      )}
      {camera.stream_type === 'image' && (
        <img src={`${camera.url}${sep}t=${tick}`} alt={`Latest view: ${camera.name}`} onError={() => setErr('The camera is offline right now.')} />
      )}
      {err && <div className="overlay-msg" style={{ background: 'rgba(0,0,0,0.75)' }}>{err}</div>}
    </div>
  );
}
