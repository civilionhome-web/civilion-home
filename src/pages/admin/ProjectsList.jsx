import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { Spinner, ErrorBox } from '../../components/ui';

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
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    supabase.from('projects').select('*').order('created_at', { ascending: false }).then(({ data, error: e }) => {
      if (e) setError(e);
      setRows(data || []);
    });
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
      <div className="form-grid">
        {list.map((p) => (
          <Link key={p.id} to={`/admin/project/${p.id}`} className="card project-card">
            <div className="between"><span className="card-title">{p.name}</span>{p.archived && <span className="pill upcoming">Archived</span>}</div>
            <div className="small muted">{p.location || '—'} · {p.pm_name || 'No PM set'}</div>
            <div className="stack-bar" style={{ height: 8 }}><div className="paid" style={{ width: `${p.percent_complete}%` }} /></div>
            <div className="small">{p.percent_complete}% · {p.stage_label || 'Not started'}</div>
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
