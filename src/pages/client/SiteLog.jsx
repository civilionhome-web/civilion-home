import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useProject } from './ClientLayout';
import { longDate } from '../../lib/format';
import { Icon, Photo, VideoClip, Spinner } from '../../components/ui';
import { PhotoBrowser } from './Home';

const WEATHER_ICON = { Sunny: '☀️', Cloudy: '⛅', 'Light rain': '🌦️', 'Heavy rain': '🌧️' };

export function LogEntry({ log, photos: media, onOpen, compact = false }) {
  const photos = media.filter((m) => m.kind !== 'video');
  const videos = media.filter((m) => m.kind === 'video');
  const shown = compact ? photos.slice(0, 3) : photos;
  return (
    <>
      <div className="small muted">
        {[log.weather && `${WEATHER_ICON[log.weather] || ''} ${log.weather}`.trim(), log.workers != null ? `${log.workers} workers on site` : ''].filter(Boolean).join(' · ')}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{log.work_done}</div>
      {!compact && log.materials && <div className="small"><span className="muted">Materials received:</span> {log.materials}</div>}
      {!compact && log.remarks && <div className="small"><span className="muted">Remarks:</span> {log.remarks}</div>}
      {videos.length > 0 && !compact && (
        <div style={{ display: 'grid', gap: 8 }}>
          {videos.map((v) => <VideoClip key={v.id} path={v.path} />)}
        </div>
      )}
      {videos.length > 0 && compact && (
        <div style={{ display: 'grid', gap: 6 }}>
          <VideoClip path={videos[0].path} />
          {videos.length > 1 && <span className="small muted">+{videos.length - 1} more video{videos.length > 2 ? 's' : ''} in the daily log</span>}
        </div>
      )}
      {shown.length > 0 && (
        <div className="photo-grid">
          {shown.map((p, i) => (
            compact && i === 2 && photos.length > 3
              ? <button key={p.id} onClick={() => onOpen(photos, p)} aria-label={`Open photos, ${photos.length - 2} more`} style={{ position: 'relative' }}>
                  <Photo path={p.path} alt="" />
                  <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(138,28,34,0.55)', color: '#fff', fontSize: 15 }}>+{photos.length - 2}</span>
                </button>
              : <button key={p.id} onClick={() => onOpen(photos, p)} aria-label={p.caption || 'Open site photo'}><Photo path={p.path} alt={p.caption} /></button>
          ))}
        </div>
      )}
    </>
  );
}

export default function SiteLog() {
  const { project } = useProject();
  const [logs, setLogs] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [box, setBox] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('site_logs').select('*').eq('project_id', project.id).order('log_date', { ascending: false }).order('created_at', { ascending: false }).limit(120),
      supabase.from('site_log_photos').select('*').eq('project_id', project.id).order('created_at').limit(2000),
    ]).then(([l, p]) => { setLogs(l.data || []); setPhotos(p.data || []); });
  }, [project.id]);

  return (
    <div className="screen no-tabs">
      <div className="back-head">
        <Link to="/" className="icon-btn" aria-label="Back to home"><Icon name="back" stroke={2.2} /></Link>
        <h1>Daily site log</h1>
      </div>
      <div className="content">
        {!logs && <Spinner full={false} />}
        {logs && logs.length === 0 && <div className="card empty">Your engineer’s daily log will appear here.</div>}
        {logs?.map((log) => (
          <div key={log.id} className="card">
            <span className="card-title" style={{ fontSize: 15 }}>{longDate(log.log_date)}</span>
            <LogEntry log={log} photos={photos.filter((p) => p.log_id === log.id)} onOpen={(list, start) => setBox({ list, start })} />
          </div>
        ))}
      </div>
      {box && <PhotoBrowser photos={box.list} start={box.start} onClose={() => setBox(null)} />}
    </div>
  );
}
