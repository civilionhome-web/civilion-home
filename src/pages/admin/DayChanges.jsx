// Changes during the day: hindrances and labour / team / machinery shifts between sites.
import { useState } from 'react';
import { supabase, must } from '../../lib/supabase';
import { ErrorBox } from '../../components/ui';
import { CAUSES } from '../../lib/schedule';
import { splitItems } from '../../lib/dayplan';

export const KINDS = [
  { id: 'hindrance', label: 'Hindrance' },
  { id: 'labour', label: 'Labour shifted' },
  { id: 'team', label: 'Team shifted' },
  { id: 'machinery', label: 'Machinery shifted' },
  { id: 'split', label: 'Half day here, rest elsewhere' },
];
const HINDRANCE_REASONS = ['Heavy rain', 'Material not arrived', 'Power cut', 'Client stopped work', 'Drawing / decision pending', 'Machinery breakdown'];
const LABOUR_TYPES = ['Masons', 'Helpers', 'Carpenters', 'Bar benders', 'Electricians', 'Plumbers', 'Painters'];
const causeLabel = (id) => CAUSES[id] || id;

// One-line description, from the point of view of `siteId`
export function changeText(c, siteName, siteId) {
  const other = siteName(c.to_project_id);
  const here = siteName(c.project_id);
  const t = (s) => (s ? ` at ${s}` : '');
  const w = c.workers ? `${c.workers} ` : '';
  const incoming = siteId && c.to_project_id === siteId;
  let s;
  switch (c.kind) {
    case 'hindrance':
      s = `Hindrance: ${c.reason || '—'}${c.at_time ? ` · ${c.at_time}${c.until_time ? `–${c.until_time}` : ' onwards'}` : ''}${c.caused_by ? ` · ${causeLabel(c.caused_by)}` : ''}`;
      break;
    case 'labour':
      s = incoming ? `${w}${c.item || 'workers'} came from ${here}${t(c.at_time)}` : `${w}${c.item || 'workers'} shifted to ${other}${t(c.at_time)}`;
      break;
    case 'team':
      s = incoming ? `Team ${c.item || ''}${c.workers ? ` (${c.workers})` : ''} came from ${here}${t(c.at_time)}` : `Team ${c.item || ''}${c.workers ? ` (${c.workers})` : ''} shifted to ${other}${t(c.at_time)}`;
      break;
    case 'machinery':
      s = incoming ? `${c.item || 'Machinery'} came from ${here}${t(c.at_time)}` : `${c.item || 'Machinery'} shifted to ${other}${t(c.at_time)}`;
      break;
    default:
      s = incoming ? `${w}${c.item || 'Team'}: rest of the day here (half day at ${here})${t(c.at_time)}` : `${w}${c.item || 'Team'}: half day here, rest at ${other}${t(c.at_time)}`;
  }
  return s + (c.kind !== 'hindrance' && c.reason ? ` · ${c.reason}` : '');
}

export function SiteChanges({ project, date, today, changes, projects, siteName, names, isAdmin, userId, plans, say, onChanged }) {
  const [open, setOpen] = useState(false);
  const mine = changes.filter((c) => c.project_id === project.id || c.to_project_id === project.id);
  const canAdd = isAdmin || date === today;
  return (
    <>
      {mine.length > 0 && (
        <div className="change-list">
          {mine.map((c) => (
            <ChangeRow key={c.id} c={c} siteId={project.id} siteName={siteName} names={names} isAdmin={isAdmin}
              canRemove={isAdmin || (c.created_by === userId && date === today && c.status !== 'approved')} say={say} onChanged={onChanged} />
          ))}
        </div>
      )}
      {open ? (
        <ChangeForm project={project} date={date} projects={projects} plans={plans} isAdmin={isAdmin} say={say}
          onDone={() => { setOpen(false); onChanged(); }} onCancel={() => setOpen(false)} />
      ) : canAdd && (
        <button className="btn small ghost no-print" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>Record change (hindrance / shifting)</button>
      )}
    </>
  );
}

function ChangeRow({ c, siteId, siteName, names, isAdmin, canRemove, say, onChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, msg) => {
    setBusy(true); setError(null);
    try { await fn(); say(msg); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const status = c.kind === 'hindrance' ? { pending: 'Waiting for approval', approved: 'In hindrance register', rejected: 'Rejected' }[c.status] : null;
  return (
    <div className={`change-row k-${c.kind}${c.status === 'rejected' ? ' rejected' : ''}`}>
      <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div>{changeText(c, siteName, siteId)}</div>
        {status && <span className={`pill ${c.status === 'approved' ? 'done' : c.status === 'rejected' ? 'changes' : 'due'}`}>{status}</span>}
      </div>
      <div className="small muted">By {names[c.created_by] || 'staff'}{c.admin_note ? ` · Admin: ${c.admin_note}` : ''}</div>
      {isAdmin && c.kind === 'hindrance' && c.status === 'pending' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <input className="input" style={{ height: 36, fontSize: 14 }} placeholder="Note to staff (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" disabled={busy} onClick={() => run(() => must(supabase.from('day_changes').update({ status: 'approved', admin_note: note.trim() }).eq('id', c.id)), 'Hindrance approved and added to the register')}>Approve hindrance</button>
            <button className="btn small ghost" disabled={busy} onClick={() => run(() => must(supabase.from('day_changes').update({ status: 'rejected', admin_note: note.trim() }).eq('id', c.id)), 'Hindrance rejected')}>Reject</button>
          </div>
        </div>
      )}
      {canRemove && (
        <button className="link-btn small no-print" disabled={busy}
          onClick={() => window.confirm(c.hindrance_id ? 'Remove this entry? (The hindrance register entry stays; remove it from the Hindrances tab if needed.)' : 'Remove this entry?')
            && run(() => must(supabase.from('day_changes').delete().eq('id', c.id)), 'Removed')}>Remove</button>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

function ChangeForm({ project, date, projects, plans, isAdmin, say, onDone, onCancel }) {
  const [kind, setKind] = useState('hindrance');
  const [f, setF] = useState({ reason: '', caused_by: 'weather', at_time: '', until_time: '', item: '', workers: '', to: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const others = projects.filter((p) => p.id !== project.id);
  const sitePlans = plans.filter((p) => p.project_id === project.id);
  const teams = [...new Set(sitePlans.flatMap((p) => (p.tasks || []).map((t) => (t.team || '').trim())).filter(Boolean))];
  const machines = [...new Set(sitePlans.flatMap((p) => splitItems(p.equipment)))];

  async function save(e) {
    e.preventDefault();
    if (kind === 'hindrance' && !f.reason.trim()) return setError(new Error('Write the reason for the hindrance.'));
    if (kind !== 'hindrance' && !f.to) return setError(new Error('Pick the site they moved to.'));
    if ((kind === 'team' || kind === 'machinery' || kind === 'split') && !f.item.trim()) return setError(new Error(kind === 'machinery' ? 'Write which machinery moved.' : 'Write the team / labour name.'));
    if (kind === 'labour' && !f.workers) return setError(new Error('Write how many workers moved.'));
    const row = {
      change_date: date, project_id: project.id, kind,
      to_project_id: kind === 'hindrance' ? null : f.to,
      item: kind === 'hindrance' ? '' : f.item.trim(),
      workers: f.workers === '' || kind === 'hindrance' || kind === 'machinery' ? null : Math.max(0, parseInt(f.workers, 10) || 0),
      at_time: f.at_time, until_time: kind === 'hindrance' ? f.until_time : '',
      reason: f.reason.trim(), caused_by: kind === 'hindrance' ? f.caused_by : null,
    };
    setBusy(true); setError(null);
    try {
      await must(supabase.from('day_changes').insert(row));
      say(kind === 'hindrance' ? (isAdmin ? 'Hindrance added to the register' : 'Hindrance sent to admin for approval') : 'Shift recorded — admin and the other site are told');
      onDone();
    } catch (err) { setError(err); setBusy(false); }
  }

  return (
    <form className="leave-form no-print" onSubmit={save}>
      <b className="small">Change at {project.name}</b>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {KINDS.map((k) => <button type="button" key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>)}
      </div>

      {kind === 'hindrance' ? (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {HINDRANCE_REASONS.map((r) => <button type="button" key={r} className={`chip${f.reason === r ? ' on' : ''}`} onClick={() => setF({ ...f, reason: r, caused_by: r === 'Heavy rain' ? 'weather' : r === 'Client stopped work' || r === 'Drawing / decision pending' ? 'client' : r === 'Power cut' ? 'authority' : f.caused_by })}>{r}</button>)}
          </div>
          <input className="input" placeholder="Reason (you can add details)" value={f.reason} onChange={set('reason')} />
          <div className="change-grid">
            <label className="field"><span>Caused by</span>
              <select className="input" value={f.caused_by} onChange={set('caused_by')}>{Object.entries(CAUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="field"><span>From</span><input className="input" type="time" value={f.at_time} onChange={set('at_time')} /></label>
            <label className="field"><span>Till</span><input className="input" type="time" value={f.until_time} onChange={set('until_time')} /></label>
          </div>
          <div className="small muted">{isAdmin ? 'Goes straight into the project’s hindrance register.' : 'The admin approves it before it goes into the project’s hindrance register (clients see that register).'}</div>
        </>
      ) : (
        <>
          <div className="change-grid">
            {kind !== 'machinery' && (
              <label className="field"><span>{kind === 'labour' ? 'Type of labour' : 'Team / gang'}</span>
                <input className="input" list={`chg-${kind}`} placeholder={kind === 'labour' ? 'Masons' : 'Rajan masons'} value={f.item} onChange={set('item')} />
                <datalist id={`chg-${kind}`}>{(kind === 'labour' ? LABOUR_TYPES : teams).map((x) => <option key={x} value={x} />)}</datalist></label>
            )}
            {kind === 'machinery' && (
              <label className="field"><span>Machinery / tool / vehicle</span>
                <input className="input" list="chg-mach" placeholder="Concrete mixer" value={f.item} onChange={set('item')} />
                <datalist id="chg-mach">{machines.map((x) => <option key={x} value={x} />)}</datalist></label>
            )}
            {kind !== 'machinery' && (
              <label className="field"><span>No. of workers</span><input className="input" type="number" min="0" inputMode="numeric" value={f.workers} onChange={set('workers')} /></label>
            )}
            <label className="field"><span>{kind === 'split' ? 'Rest of day at' : 'Moved to site'}</span>
              <select className="input" value={f.to} onChange={set('to')}>
                <option value="">Pick a site…</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="field"><span>{kind === 'split' ? 'Moved at' : 'Time'}</span><input className="input" type="time" value={f.at_time} onChange={set('at_time')} /></label>
          </div>
          <input className="input" placeholder="Reason (e.g. rain here, urgent work there)" value={f.reason} onChange={set('reason')} />
        </>
      )}
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
