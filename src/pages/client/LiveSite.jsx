import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useProject } from './ClientLayout';
import { dualTime, timeIn, IST } from '../../lib/format';
import { Icon, Spinner } from '../../components/ui';
import VideoPlayer from '../../components/VideoPlayer';

export default function LiveSite() {
  const { project } = useProject();
  const nav = useNavigate();
  const [cams, setCams] = useState(null);
  const [events, setEvents] = useState([]);
  const [sel, setSel] = useState(0);
  const [now, setNow] = useState(new Date());
  const fs = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    Promise.all([
      supabase.from('cameras').select('*').eq('project_id', project.id).eq('active', true).order('position'),
      supabase.from('site_events').select('*').eq('project_id', project.id).gte('happened_at', since).order('happened_at', { ascending: false }),
    ]).then(([c, e]) => { setCams(c.data || []); setEvents(e.data || []); });
  }, [project.id]);

  const cam = cams?.[sel] || null;

  return (
    <div className="screen no-tabs">
      <div className="live-head">
        <Link to="/" className="icon-btn" style={{ color: '#f3eeee' }} aria-label="Back to home"><Icon name="back" stroke={2.2} /></Link>
        <div className="title">Live site</div>
        <div style={{ fontSize: 12, color: '#b3a8a9' }}>{dualTime(now)}</div>
      </div>

      {!cams ? <Spinner /> : (
        <>
          <div style={{ position: 'relative' }}>
            <VideoPlayer camera={cam} onFullscreenRef={fs} />
            {cam && <div className="live-badge">● LIVE · {cam.name}</div>}
          </div>

          {cams.length > 1 && (
            <div className="cam-chips" role="tablist" aria-label="Cameras">
              {cams.map((c, i) => (
                <button key={c.id} role="tab" aria-selected={i === sel} className={`cam-chip ${i === sel ? 'on' : ''}`} onClick={() => setSel(i)}>{c.name}</button>
              ))}
            </div>
          )}

          <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div className="section-label" style={{ color: '#b3a8a9' }}>Today on site</div>
            <div className="dark-card">
              {events.length === 0 && <div style={{ color: '#b3a8a9', fontSize: 14 }}>Site activity logged by your engineer will show here.</div>}
              {events.map((e) => (
                <div key={e.id} className="event-row">
                  <span className="d" /><span style={{ flex: 1 }}>{e.text}</span>
                  <span style={{ color: '#b3a8a9' }}>{timeIn(e.happened_at, IST)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', gap: 10, paddingTop: 16 }}>
              {cam && cam.stream_type !== 'image' && (
                <button className="btn dark-outline" style={{ flex: 1 }} onClick={() => fs.current?.()}>
                  <Icon name="expand" size={18} /> Full screen
                </button>
              )}
              <button className="btn coral" style={{ flex: 1 }}
                onClick={() => nav('/chat', { state: { draft: cam ? `About the ${cam.name} camera view: ` : '' } })}>
                Ask about this view
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
