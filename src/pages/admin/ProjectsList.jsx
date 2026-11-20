import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { Spinner, ErrorBox } from '../../components/ui';
import { inr } from '../../lib/format';
import { loadAllVariations } from '../../lib/variations';
import { useAuth } from '../../lib/auth';
import { tomorrowStr } from '../../lib/dayplan';

// Default stages for a new house; staff can edit them per project.
export const DEFAULT_STAGES = [
  'Agreement & mobilisation',
  'Foundation & plinth',
  'Ground floor slab',
  'First floor slab / roof',
  'Masonry & plastering',
  'Electrical, plumbing, flooring',
  'Painting & finishing',
  'Handover & OC',
];

export default function ProjectsList() {
  const [rows, setRows] = useState(null);
  const [vo, setVo] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [tmr, setTmr] = useState(null);

  useEffect(() => {
    supabase.from('projects').select('*').order('created_at', { ascending: false }).then(({ data, error: e }) => {
      if (e) setError(e);
      setRows(data || []);
    });
    loadAllVariations().then(setVo);
    supabase.from('day_plans').select('project_id, status').eq('plan_date', tomorrowStr()).then(({ data }) => setTmr(data || []));
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const p = await must(supabase.from('projects').insert({ name: name.trim(), location: location.trim(), stage_label: DEFAULT_STAGES[0] }).select().single());
      await must(supabase.from('stages').insert(DEFAULT_STAGES.map((s, i) => ({ project_id: p.id, position: i, name: s, status: i === 0 ? 'current' : 'upcoming' }))));
      nav(`/admin/project/${p.id}`);
    } catch (err) { setError(err); setBusy(false); }
  }

  if (!rows) return <Spinner />;
  const list = rows.filter((r) => showArchived || !r.archived);

  return (
    <>
      <div className="between"><h1>Projects</h1>
        <label className="row small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show finished / archived</label>
      </div>
      <ErrorBox error={error} />
      {tmr && (() => {
        const active = rows.filter((r) => !r.archived).length;
        const planned = new Set(tmr.map((t) => t.project_id)).size;
        const waiting = tmr.filter((t) => t.status === 'submitted').length;
        const allDone = active > 0 && planned >= active;
        return (
          <Link to="/admin/planner" className={`card plan-staff-nudge${allDone ? '' : ' warn'}`}>
            <span style={{ fontSize: 22 }}>🗓️</span>
            <div style={{ flex: 1 }}>
              <b>Tomorrow's day plan</b>
              <div className="small">{isAdmin
                ? `${planned} of ${active} sites planned${waiting ? ` · ${waiting} waiting for your review` : ''}`
                : allDone ? `You've planned all ${active} sites` : `You've planned ${planned} of ${active} sites — please fill in the rest before evening`}</div>
            </div>
            <span className="small" style={{ fontWeight: 600, color: 'var(--maroon)' }}>Open planner →</span>
          </Link>
        );
      })()}
      <div className="form-grid">
        {list.map((p) => (
          <Link key={p.id} to={`/admin/project/${p.id}`} className="card project-card">
            <div className="between"><span className="card-title">{p.name}</span>{p.archived && <span className="pill upcoming">Archived</span>}</div>
            <div className="small muted">{p.location || '—'} · {p.pm_name || 'No PM set'}</div>
            <div className="stack-bar" style={{ height: 8 }}><div className="paid" style={{ width: `${p.percent_complete}%` }} /></div>
            <div className="small">{p.percent_complete}% · {p.stage_label || 'Not started'}</div>
            {Number(p.contract_amount) > 0 && (() => {
              const v = vo[p.id] || { total: 0, count: 0 };
              return (
                <div className="small" style={{ borderTop: '1px solid var(--line, #e7e2dc)', paddingTop: 6, display: 'grid', gap: 2 }}>
                  <div className="between"><span className="muted">Contract</span><span>{inr(p.contract_amount)}</span></div>
                  <div className="between"><span className="muted">Variations{v.count ? ` (${v.count})` : ''}</span>
                    <span className={v.total > 0 ? 'amber' : v.total < 0 ? 'green' : ''} style={{ fontWeight: 600 }}>{v.total > 0 ? '+' : ''}{v.total ? inr(v.total) : '₹0'}</span></div>
                  <div className="between"><b>Total cost</b><b>{inr(Number(p.contract_amount) + v.total)}</b></div>
                </div>
              );
            })()}
          </Link>
        ))}
        <form className="card" onSubmit={create}>
          <div className="card-title">New project</div>
          <label className="field"><span>Project name (as the client sees it)</span>
            <input className="input" required placeholder="Anil & Divya's Home" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field"><span>Location</span>
            <input className="input" placeholder="Mannarkkad" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
        </form>
      </div>
    </>
  );
}
