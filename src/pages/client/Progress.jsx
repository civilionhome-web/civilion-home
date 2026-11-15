import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useProject } from './ClientLayout';
import { shortDate } from '../../lib/format';
import { Photo, Spinner } from '../../components/ui';
import { PhotoBrowser } from './Home';

const STATUS = { done: 'Done', current: 'In progress', upcoming: 'Upcoming' };

export default function Progress() {
  const { project } = useProject();
  const [stages, setStages] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [box, setBox] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('stages').select('*').eq('project_id', project.id).order('position'),
      supabase.from('updates').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('update_photos').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(300),
    ]).then(([s, u, p]) => { setStages(s.data || []); setUpdates(u.data || []); setPhotos(p.data || []); });
  }, [project.id]);

  if (!stages) return <Spinner />;
  const currentIdx = stages.findIndex((s) => s.status === 'current');
  const doneCount = stages.filter((s) => s.status === 'done').length;
  const stageNo = currentIdx >= 0 ? currentIdx + 1 : Math.min(doneCount + 1, stages.length);
  const schedColor = project.schedule_status === 'Delayed' ? '#9b1c1c' : project.schedule_status === 'Slight delay' ? 'var(--amber)' : 'var(--green)';

  return (
    <div className="screen">
      <div className="page-head">
        <h1>Progress</h1>
        <div className="sub">
          {stages.length ? `Stage ${stageNo} of ${stages.length}` : 'Stages coming soon'}
          {project.handover_target ? ` · handover target ${project.handover_target}` : ''}
        </div>
      </div>
      <div className="content">
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="card" style={{ flex: 1, gap: 0, padding: '10px 12px' }}><div className="label">Done</div><div className="big" style={{ fontSize: 22 }}>{project.percent_complete}%</div></div>
          <div className="card" style={{ flex: 1, gap: 0, padding: '10px 12px' }}><div className="label">Schedule</div><div className="big" style={{ fontSize: 22, color: schedColor }}>{project.schedule_status}</div></div>
        </div>

        {stages.length > 0 && (
          <div className="card flush">
            {stages.map((s, i) => (
              <div key={s.id} className="stage">
                <div className={`mark ${s.status}`}>{s.status === 'done' ? '✓' : i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.name}</div>
                  {s.note && <div className="small muted">{s.note}</div>}
                </div>
                <span className={`pill ${s.status}`}>{STATUS[s.status]}</span>
              </div>
            ))}
          </div>
        )}

        <div className="section-label">Site updates</div>
        {updates.length === 0 && <div className="card muted" style={{ fontSize: 14 }}>No updates posted yet.</div>}
        {updates.map((u) => {
          const ph = photos.filter((p) => p.update_id === u.id);
          return (
            <div key={u.id} className="card">
              <div className="between"><span className="card-title" style={{ fontSize: 15 }}>{u.period || 'Update'}</span><span className="small muted">{shortDate(u.created_at)}</span></div>
              <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{u.body}</div>
              {ph.length > 0 && (
                <div className="photo-grid">
                  {ph.map((p) => <button key={p.id} onClick={() => setBox({ list: ph, start: p })} aria-label={p.caption || 'Open site photo'}><Photo path={p.path} alt={p.caption} /></button>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {box && <PhotoBrowser photos={box.list} start={box.start} onClose={() => setBox(null)} />}
    </div>
  );
}
