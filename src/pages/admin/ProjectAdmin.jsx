import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Spinner, ErrorBox, useToast } from '../../components/ui';
import ChatView from '../../components/ChatView';
import HindranceSection from './HindranceSection';
import DailyLogSection from './DailyLogSection';
import { inr } from '../../lib/format';
import { loadVariations } from '../../lib/variations';
import { ClientsSection, StagesSection, UpdatesSection, CameraSection, BillsSection, DecisionsSection } from './sections';
import DocumentsSection from './DocumentsSection';

const TABS = ['Overview', 'Clients', 'Daily log', 'Stages', 'Hindrances', 'Updates', 'Cameras & site log', 'Bills', 'Documents', 'Decisions', 'Chat'];

export default function ProjectAdmin() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState(() => sessionStorage.getItem('civ_admin_tab') || 'Overview');
  const [error, setError] = useState(null);
  const [toast, say] = useToast();
  const [vo, setVo] = useState(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
    if (e) setError(e);
    setProject(data || false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVariations(id).then(setVo); }, [id, tab]);
  useEffect(() => { sessionStorage.setItem('civ_admin_tab', tab); }, [tab]);

  if (project === null) return <Spinner />;
  if (project === false) return <><ErrorBox error={error} /><p>Project not found. <Link to="/admin">Back to projects</Link></p></>;

  const props = { project, reloadProject: load, say };
  return (
    <>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <div>
          <Link to="/admin" className="small">← All projects</Link>
          <h1>{project.name}</h1>
          <div className="small muted">{[project.location, `${project.percent_complete || 0}% complete`, project.stage_label].filter(Boolean).join(' · ')}</div>
          {Number(project.contract_amount) > 0 && vo && (
            <div className="small" style={{ marginTop: 2 }}>
              Contract {inr(project.contract_amount)} · Variations{vo.items.length ? ` (${vo.items.length})` : ''}{' '}
              <b className={vo.total > 0 ? 'amber' : vo.total < 0 ? 'green' : ''}>{vo.total > 0 ? '+' : ''}{vo.total ? inr(vo.total) : '₹0'}</b>
              {' '}· <b>Total {inr(Number(project.contract_amount) + vo.total)}</b>
            </div>
          )}
        </div>
        <Link className="btn ghost small" to="/" onClick={() => localStorage.setItem('civ_project', project.id)}>See as client</Link>
      </div>
      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'Overview' && <Overview {...props} />}
      {tab === 'Clients' && <ClientsSection {...props} />}
      {tab === 'Daily log' && <DailyLogSection {...props} />}
      {tab === 'Stages' && <StagesSection {...props} />}
      {tab === 'Hindrances' && <HindranceSection {...props} />}
      {tab === 'Updates' && <UpdatesSection {...props} />}
      {tab === 'Cameras & site log' && <CameraSection {...props} />}
      {tab === 'Bills' && <BillsSection {...props} />}
      {tab === 'Documents' && <DocumentsSection {...props} />}
      {tab === 'Decisions' && <DecisionsSection {...props} />}
      {tab === 'Chat' && (
        <div className="chat-wrap">
          <ChatView projectId={project.id} staffView placeholder="Reply to the client" />
        </div>
      )}
      {toast}
    </>
  );
}

const FIELDS = [
  ['name', 'Project name', 'text'],
  ['location', 'Location', 'text'],
  ['client_greeting_name', 'Client first name (for "Good morning, …")', 'text'],
  ['stage_label', 'Current stage line on home screen', 'text', 'First floor slab · curing'],
  ['percent_complete', '% complete', 'number'],
  ['schedule_status', 'Schedule', 'select', ['On track', 'Ahead', 'Slight delay', 'Delayed']],
  ['start_date', 'Project start date', 'date'],
  ['completion_date', 'Completion date as per agreement', 'date'],
  ['handover_target', 'Handover target text (used only if no completion date)', 'text', 'Aug 2027'],
  ['contract_amount', 'Contract amount incl. GST (₹)', 'number'],
  ['boq_amount', 'BOQ amount (₹)', 'number'],
  ['client_currency', 'Client\'s currency for "≈" amounts', 'select', ['AED', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'USD', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'INR']],
  ['pm_name', 'Project manager name', 'text'],
  ['pm_phone', 'PM WhatsApp number (with country code)', 'tel', '919876543210'],
];

function Overview({ project, reloadProject, say }) {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => setF(project), [project]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const patch = {};
    FIELDS.forEach(([k, , type]) => { patch[k] = type === 'number' ? Number(f[k] || 0) : type === 'date' ? (f[k] || null) : (f[k] ?? ''); });
    if (patch.start_date && patch.completion_date && patch.completion_date < patch.start_date) { setError(new Error('Completion date must be after the start date.')); setBusy(false); return; }
    patch.percent_complete = Math.max(0, Math.min(100, Math.round(patch.percent_complete)));
    patch.payment_instructions = f.payment_instructions || '';
    try { await must(supabase.from('projects').update(patch).eq('id', project.id)); say('Saved'); reloadProject(); }
    catch (err) { setError(err); }
    setBusy(false);
  }

  async function toggleArchive() {
    await supabase.from('projects').update({ archived: !project.archived }).eq('id', project.id);
    reloadProject();
  }

  async function del() {
    const typed = window.prompt(`This deletes the project, its bills, photos records and chat for good.\nType the project name to confirm:\n${project.name}`);
    if (typed !== project.name) return;
    const { error: e } = await supabase.from('projects').delete().eq('id', project.id);
    if (e) setError(e); else nav('/admin');
  }

  return (
    <form className="card" onSubmit={save} style={{ gap: 14 }}>
      <div className="form-grid">
        {FIELDS.map(([k, label, type, extra]) => (
          <label key={k} className="field"><span>{label}</span>
            {type === 'select'
              ? <select className="select" value={f[k] ?? ''} onChange={set(k)}>{extra.map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="input" type={type} step={type === 'number' ? 'any' : undefined} placeholder={typeof extra === 'string' ? extra : ''}
                  required={k === 'name'} value={f[k] ?? ''} onChange={set(k)} />}
          </label>
        ))}
      </div>
      <label className="field"><span>How to pay (shown to the client — your bank details, IFSC, SWIFT, notes)</span>
        <textarea className="textarea" rows={6} value={f.payment_instructions || ''} onChange={set('payment_instructions')}
          placeholder={'Account name: Civilion Builders and Developers LLP\nBank: …\nAccount no: …\nIFSC: …\nSWIFT (for transfers from abroad): …'} />
      </label>
      <ErrorBox error={error} />
      <div className="toolbar">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn ghost" onClick={toggleArchive}>{project.archived ? 'Unarchive' : 'Archive (handed over)'}</button>
        {isAdmin && <button type="button" className="btn danger" onClick={del}>Delete project</button>}
      </div>
    </form>
  );
}
