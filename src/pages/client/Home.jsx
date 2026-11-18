import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useProject } from './ClientLayout';
import { greeting, inr, lakhs, shortDate, longDate } from '../../lib/format';
import { daysInclusive, todayStr } from '../../lib/schedule';
import { LogEntry } from './SiteLog';
import { loadVariations } from '../../lib/variations';
import { Bell, useUnread } from './Notifications';
import { Icon, Logo, Photo, Lightbox } from '../../components/ui';

export default function Home() {
  const { project, projects, setProjectId } = useProject();
  const { profile, signOut, isStaff, user } = useAuth();
  const unread = useUnread(project?.id, user?.id);
  const [d, setD] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    let live = true;
    const pid = project.id;
    Promise.all([
      supabase.from('updates').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(1),
      supabase.from('update_photos').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(30),
      supabase.from('approvals').select('id,title,due_date').eq('project_id', pid).eq('status', 'open').order('due_date', { nullsFirst: false }),
      supabase.from('bills').select('id,number,title,amount,status,due_date').eq('project_id', pid),
      supabase.from('cameras').select('id,name').eq('project_id', pid).eq('active', true).order('position').limit(1),
      supabase.from('site_logs').select('*').eq('project_id', pid).order('log_date', { ascending: false }).order('created_at', { ascending: false }).limit(1),
      loadVariations(pid),
      supabase.from('stages').select('id,name,status,progress,start_date,end_date,position').eq('project_id', pid).order('position'),
    ]).then(async ([u, ph, ap, b, cam, lg, vo, st]) => {
      if (!live) return;
      const latest = u.data?.[0] || null;
      const bills = b.data || [];
      const log = lg.data?.[0] || null;
      const logPhotos = log ? ((await supabase.from('site_log_photos').select('*').eq('log_id', log.id).order('created_at')).data || []) : [];
      if (!live) return;
      setD({
        log, logPhotos, vo, stages: st.data || [],
        latest,
        photos: (ph.data || []).filter((p) => !latest || p.update_id === latest.id),
        approvals: ap.data || [],
        dueBills: bills.filter((x) => x.status === 'due').sort((x, y) => (x.due_date || '9') < (y.due_date || '9') ? -1 : 1),
        paid: bills.filter((x) => x.status === 'paid').reduce((s, x) => s + Number(x.amount), 0),
        camera: cam.data?.[0] || null,
        lastPhoto: ph.data?.[0] || null,
      });
    });
    return () => { live = false; };
  }, [project.id]);

  const name = project.client_greeting_name || profile?.full_name?.split(' ')[0] || '';
  const pct = project.percent_complete || 0;
  const todo = d ? d.approvals.length : 0;
  const todoText = d ? d.approvals.map((a) => a.title).join(' · ') : '';
  const today = todayStr();
  const dueAll = d?.dueBills || [];
  const dueTotal = Math.max(0, dueAll.reduce((s, b) => s + Number(b.amount), 0));   // credits reduce it
  const credits = dueAll.filter((b) => Number(b.amount) < 0);
  const due = dueTotal > 0 ? dueAll.filter((b) => Number(b.amount) > 0) : [];
  const overdue = due.filter((b) => b.due_date && b.due_date < today);
  const maxLate = overdue.reduce((m, b) => Math.max(m, daysInclusive(b.due_date, today) - 1), 0);
  const nextDue = due.find((b) => b.due_date && b.due_date >= today);
  const billNames = [...due, ...credits].map((b) => `Bill ${String(b.number).padStart(2, '0')} · ${b.title}${Number(b.amount) < 0 ? ` (${inr(b.amount)})` : ''}`).join('  |  ');
  const logLabel = d?.log ? (d.log.log_date === today ? 'Today' : daysInclusive(d.log.log_date, today) === 2 ? 'Yesterday' : longDate(d.log.log_date)) : '';
  const contract = Number(project.contract_amount) || 0;
  const voTotal = d?.vo?.total || 0;
  const totalCost = contract + voTotal;
  const paidPct = totalCost > 0 && d ? Math.round((d.paid / totalCost) * 100) : null;

  return (
    <div className="screen">
      <header className="hero">
        <div className="between">
          <div className="row">
            <span className="hero-logo"><Logo width={38} compact /></span>
            <span style={{ fontSize: 14, opacity: 0.9 }}>{greeting()}{name ? `, ${name}` : ''}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {isStaff && <Link to="/admin" className="round-btn" style={{ width: 'auto', padding: '0 12px', borderRadius: 22, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Admin</Link>}
            <Bell count={unread} />
            <button className="round-btn" aria-label="Sign out" onClick={() => { if (window.confirm('Sign out of Civilion Home?')) signOut(); }}><Icon name="logout" size={20} /></button>
          </div>
        </div>
        {projects.length > 1 && (
          <select className="project-select" aria-label="Choose project" value={project.id} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <h1>{project.name}{project.location ? `, ${project.location}` : ''}</h1>
      </header>

      <div className="content" style={{ paddingTop: 16 }}>
        <WorkInProgress stages={d?.stages} pct={pct} />

        <Link to="/live" className="live-card" aria-label="Watch the live site camera">
          {d?.lastPhoto && <Photo path={d.lastPhoto.path} className="thumb" alt="" />}
          <div className="live-badge">{d?.camera ? `● LIVE · ${d.camera.name}` : 'Latest site photo'}</div>
          <div className="live-cta">{d?.camera ? 'Watch site' : 'Open'}</div>
        </Link>

        {due.length > 0 && (
          <Link to="/payments" className={`card pay-warn tile-link${overdue.length ? ' overdue' : ''}`} role="alert">
            <div className="pay-warn-icon"><Icon name="alert" size={22} stroke={2.2} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {overdue.length ? 'Payment overdue' : 'Payment due'} · {inr(dueTotal)}
              </div>
              <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{billNames}</div>
              <div className="small" style={{ fontWeight: 600 }}>
                {overdue.length
                  ? `Overdue by ${maxLate} day${maxLate === 1 ? '' : 's'}${overdue.length < due.length ? ` · ${due.length - overdue.length} more due` : ''}`
                  : nextDue ? `Please pay by ${longDate(nextDue.due_date)}` : 'Please pay at your earliest'}
              </div>
            </div>
            <span className="pay-warn-cta">Pay</span>
          </Link>
        )}

        {todo > 0 && (
          <Link to="/approvals" className="card warn tile-link" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div className="count-badge">{todo}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{todo === 1 ? 'A decision is waiting for you' : 'Decisions waiting for you'}</div>
              <div style={{ fontSize: 13, color: 'var(--amber-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{todoText}</div>
            </div>
            <Icon name="chevron" size={18} stroke={2.4} style={{ color: 'var(--amber)' }} />
          </Link>
        )}

        {d?.log && (
          <div className="card">
            <div className="between" style={{ alignItems: 'baseline' }}>
              <span className="card-title">Daily site log</span>
              <span className="small muted">{logLabel}</span>
            </div>
            <LogEntry log={d.log} photos={d.logPhotos} compact onOpen={(list, start) => setLightbox({ list, start })} />
            <Link to="/site-log" style={{ fontSize: 14, fontWeight: 600 }}>All daily logs</Link>
          </div>
        )}

        <div className="card">
          <div className="between" style={{ alignItems: 'baseline' }}>
            <span className="card-title">This week on site</span>
            <span className="small muted">{d?.latest ? (d.latest.period || shortDate(d.latest.created_at)) : ''}</span>
          </div>
          {d && !d.latest && <div className="muted" style={{ fontSize: 14 }}>Your first site update will appear here.</div>}
          {d?.latest && <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{d.latest.body}</div>}
          {d?.photos?.length > 0 && (
            <div className="photo-grid">
              {d.photos.slice(0, 3).map((p, i) => (
                i === 2 && d.photos.length > 3
                  ? <button key={p.id} onClick={() => setLightbox({ list: d.photos, start: p })} aria-label={`Open photos, ${d.photos.length - 2} more`} style={{ position: 'relative' }}>
                      <Photo path={p.path} alt="" />
                      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(138,28,34,0.55)', color: '#fff', fontSize: 15 }}>+{d.photos.length - 2}</span>
                    </button>
                  : <button key={p.id} onClick={() => setLightbox({ list: d.photos, start: p })} aria-label={p.caption || 'Open site photo'}><Photo path={p.path} alt={p.caption} /></button>
              ))}
            </div>
          )}
          <Link to="/progress" style={{ fontSize: 14, fontWeight: 600 }}>All updates and photos</Link>
        </div>

        {contract > 0 && d && (
          <Link to="/payments" className="card tile-link" style={{ gap: 6 }}>
            <span className="card-title">Project cost</span>
            <div className="between small"><span className="muted">Contract (as per agreement)</span><b>{inr(contract)}</b></div>
            <div className="between small">
              <span className="muted">Variations{d.vo.items.length ? ` (${d.vo.items.length} approved)` : ''}</span>
              <b className={voTotal > 0 ? 'amber' : voTotal < 0 ? 'green' : ''}>{voTotal > 0 ? '+' : ''}{voTotal ? inr(voTotal) : '₹0'}</b>
            </div>
            <div className="between" style={{ borderTop: '1px solid var(--line, #e7e2dc)', paddingTop: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Total project cost</span><b style={{ fontSize: 16 }}>{inr(totalCost)}</b>
            </div>
          </Link>
        )}

        <div className="grid2">
          <Link to="/payments" className="card tile-link" style={{ gap: 2, padding: 12 }}>
            <div className="label">Paid so far</div>
            <div className="big">{d ? lakhs(d.paid) : '—'}</div>
            {paidPct !== null && <div className="small green" style={{ fontWeight: 600 }}>{paidPct}% of total cost</div>}
          </Link>
          <Link to="/chat" className="card tile-link" style={{ gap: 2, padding: 12 }}>
            <div className="label">Project manager</div>
            <div className="big" style={{ fontSize: 17 }}>{project.pm_name || 'Civilion team'}</div>
            <div className="small" style={{ color: 'var(--maroon)', fontWeight: 600 }}>Message</div>
          </Link>
        </div>
      </div>
      {lightbox && <PhotoBrowser photos={lightbox.list} start={lightbox.start} onClose={() => setLightbox(null)} />}
    </div>
  );
}

export function PhotoBrowser({ photos, start, onClose }) {
  const [i, setI] = useState(Math.max(0, photos.findIndex((p) => p.id === start.id)));
  const p = photos[i];
  return (
    <>
      <Lightbox path={p.path} caption={`${p.caption ? p.caption + ' · ' : ''}${i + 1} of ${photos.length}`} onClose={onClose} />
      {photos.length > 1 && (
        <div style={{ position: 'fixed', zIndex: 61, bottom: 'calc(56px + var(--safe-bottom))', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12 }}>
          <button className="btn ghost small" style={{ background: '#fff' }} disabled={i === 0} onClick={() => setI(i - 1)}>Previous</button>
          <button className="btn ghost small" style={{ background: '#fff' }} disabled={i === photos.length - 1} onClick={() => setI(i + 1)}>Next</button>
        </div>
      )}
    </>
  );
}

// Stages being worked on right now, each with its own %, plus overall progress
function WorkInProgress({ stages, pct }) {
  if (!stages) return null;
  const cur = stages.filter((s) => s.status === 'current');
  const next = stages.find((s) => s.status === 'upcoming');
  const done = stages.filter((s) => s.status === 'done').length;
  const dates = (s) => s.start_date && s.end_date ? `${shortDate(s.start_date)} – ${shortDate(s.end_date)}`
    : s.end_date ? `Till ${shortDate(s.end_date)}` : s.start_date ? `From ${shortDate(s.start_date)}` : '';
  return (
    <Link to="/progress" className="card tile-link" style={{ gap: 10 }}>
      <div className="between" style={{ alignItems: 'baseline' }}>
        <span className="card-title">{cur.length ? 'Work in progress' : 'Construction progress'}</span>
        {stages.length > 0 && <span className="small muted">{done} of {stages.length} stages done</span>}
      </div>
      {cur.map((s) => (
        <div key={s.id} style={{ display: 'grid', gap: 4 }}>
          <div className="between" style={{ gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>{s.name}</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--maroon, #8a1c22)' }}>{s.progress}%</span>
          </div>
          <div className="wip-bar" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.name} progress`}>
            <div style={{ width: `${s.progress}%` }} />
          </div>
          {dates(s) && <span className="small muted">{dates(s)}</span>}
        </div>
      ))}
      {!cur.length && next && <div className="small">Next stage: <b>{next.name}</b>{dates(next) ? ` · ${dates(next)}` : ''}</div>}
      {!cur.length && !next && stages.length > 0 && <div className="small">All stages completed.</div>}
      <div style={{ display: 'grid', gap: 4, borderTop: '1px solid var(--line, #e7e2dc)', paddingTop: 8 }}>
        <div className="between"><span className="small" style={{ fontWeight: 600 }}>Overall project</span><span style={{ fontWeight: 700 }}>{pct}%</span></div>
        <div className="wip-bar overall" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Overall project progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}
