import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useProject } from './ClientLayout';
import { shortDate, longDate } from '../../lib/format';
import { CAUSES, hindranceDays, scheduleSummary } from '../../lib/schedule';
import { Photo, Spinner } from '../../components/ui';
import { PhotoBrowser } from './Home';

const STATUS = { done: 'Done', current: 'In progress', upcoming: 'Upcoming' };

export default function Progress() {
  const { project } = useProject();
  const [stages, setStages] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [hindrances, setHindrances] = useState([]);
  const [box, setBox] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('stages').select('*').eq('project_id', project.id).order('position'),
      supabase.from('updates').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('update_photos').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(300),
      supabase.from('hindrances').select('*').eq('project_id', project.id).order('from_date', { ascending: false }),
    ]).then(([s, u, p, h]) => { setStages(s.data || []); setUpdates(u.data || []); setPhotos(p.data || []); setHindrances(h.data || []); });
  }, [project.id]);

  if (!stages) return <Spinner />;
  const currentIdx = stages.findIndex((s) => s.status === 'current');
  const inProgress = stages.filter((s) => s.status === 'current').length;
  const doneCount = stages.filter((s) => s.status === 'done').length;
  const stageNo = currentIdx >= 0 ? currentIdx + 1 : Math.min(doneCount + 1, stages.length);
  const sch = scheduleSummary(project, hindrances);
  const handover = sch.revised ? longDate(sch.revised) : project.handover_target;
  const range = (st) => st.start_date && st.end_date ? `${shortDate(st.start_date)} – ${shortDate(st.end_date)}`
    : st.start_date ? `From ${shortDate(st.start_date)}`
    : st.end_date ? `Till ${shortDate(st.end_date)}`
    : 'Dates to be confirmed';
  const schedColor = project.schedule_status === 'Delayed' ? '#9b1c1c' : project.schedule_status === 'Slight delay' ? 'var(--amber)' : 'var(--green)';

  return (
    <div className="screen">
      <div className="page-head">
        <h1>Progress</h1>
        <div className="sub">
          {stages.length ? (inProgress > 1 ? `${inProgress} stages in progress · ${doneCount} of ${stages.length} done` : `Stage ${stageNo} of ${stages.length}`) : 'Stages coming soon'}
          {handover ? ` · handover ${handover}` : ''}
        </div>
      </div>
      <div className="content">
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="card" style={{ flex: 1, gap: 0, padding: '10px 12px' }}><div className="label">Done</div><div className="big" style={{ fontSize: 22 }}>{project.percent_complete}%</div></div>
          <div className="card" style={{ flex: 1, gap: 0, padding: '10px 12px' }}><div className="label">Schedule</div><div className="big" style={{ fontSize: 22, color: schedColor }}>{project.schedule_status}</div></div>
        </div>

        {(sch.start || sch.agreed) && (
          <div className="card" style={{ gap: 6 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Time schedule</div>
            {sch.start && <div className="between small"><span className="muted">Work started</span><b>{longDate(sch.start)}</b></div>}
            {sch.agreed && <div className="between small"><span className="muted">Completion as per agreement</span><b>{longDate(sch.agreed)}</b></div>}
            {sch.duration && <div className="between small"><span className="muted">Contract period</span><b>{sch.duration} days</b></div>}
            {sch.clientDays > 0 && <div className="between small"><span className="muted">Extension for client hindrances</span><b className="amber">+{sch.clientDays} days</b></div>}
            {sch.revised && sch.clientDays > 0 && <div className="between small"><span className="muted">Revised completion</span><b>{longDate(sch.revised)}</b></div>}
          </div>
        )}

        {stages.length > 0 && (
          <div className="card flush">
            {stages.map((s, i) => (
              <div key={s.id} className="stage">
                <div className={`mark ${s.status}`}>{s.status === 'done' ? '✓' : i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.name}</div>
                  <div className={`small${s.start_date || s.end_date ? '' : ' muted'}`} style={s.start_date || s.end_date ? { color: 'var(--ink)' } : { fontStyle: 'italic' }}>{range(s)}</div>
                  {s.note && <div className="small muted">{s.note}</div>}
                </div>
                <span className={`pill ${s.status}`}>{s.status === 'current' ? `In progress · ${s.progress ?? 0}%` : STATUS[s.status]}</span>
              </div>
            ))}
          </div>
        )}

        {hindrances.length > 0 && (
          <>
            <div className="section-label">Hindrance register</div>
            <div className="card flush">
              {hindrances.map((h) => (
                <div key={h.id} className="stage">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{h.reason}</div>
                    <div className="small muted">
                      {shortDate(h.from_date)} – {h.to_date ? shortDate(h.to_date) : 'ongoing'} · {hindranceDays(h)} day{hindranceDays(h) === 1 ? '' : 's'}
                    </div>
                    {h.remarks && <div className="small muted">{h.remarks}</div>}
                  </div>
                  <span className={`pill ${h.caused_by === 'client' ? 'due' : 'upcoming'}`}>{CAUSES[h.caused_by]}</span>
                </div>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: -4 }}>Days lost to client hindrances extend the completion date.</div>
          </>
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
