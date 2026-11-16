import { useCallback, useEffect, useState } from 'react';
import { supabase, must } from '../../lib/supabase';
import { longDate } from '../../lib/format';
import { CAUSES, hindranceDays, scheduleSummary, todayStr } from '../../lib/schedule';
import { Spinner, ErrorBox, Icon } from '../../components/ui';

const EMPTY = { id: null, from_date: '', to_date: '', reason: '', caused_by: 'client', remarks: '' };

export function ScheduleCards({ s }) {
  const box = { flex: '1 1 140px', gap: 0, padding: '10px 12px' };
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <div className="card" style={box}><div className="label">Start</div><b>{s.start ? longDate(s.start) : '—'}</b></div>
      <div className="card" style={box}><div className="label">Completion (agreement)</div><b>{s.agreed ? longDate(s.agreed) : '—'}</b>
        {s.duration ? <div className="small muted">{s.duration} days</div> : null}</div>
      <div className="card" style={box}><div className="label">Client hindrance</div><b className={s.clientDays ? 'amber' : ''}>+{s.clientDays} day{s.clientDays === 1 ? '' : 's'}</b></div>
      <div className="card" style={box}><div className="label">Revised completion</div><b>{s.revised ? longDate(s.revised) : '—'}</b>
        {s.left != null && <div className="small muted">{s.left >= 0 ? `${s.left} days left` : `${-s.left} days over`}</div>}</div>
    </div>
  );
}

export default function HindranceSection({ project, say }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const reload = useCallback(async () => {
    const { data, error: e } = await supabase.from('hindrances').select('*').eq('project_id', project.id).order('from_date', { ascending: false });
    if (e) setError(e);
    setRows(data || []);
  }, [project.id]);
  useEffect(() => { reload(); }, [reload]);

  async function act(fn) {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  }

  async function save(e) {
    e.preventDefault();
    if (f.to_date && f.to_date < f.from_date) { setError(new Error('"To" date must be on or after the "From" date.')); return; }
    const row = { project_id: project.id, from_date: f.from_date, to_date: f.to_date || null, reason: f.reason.trim(), caused_by: f.caused_by, remarks: f.remarks.trim() };
    const ok = await act(() => must(f.id ? supabase.from('hindrances').update(row).eq('id', f.id) : supabase.from('hindrances').insert(row)));
    if (ok) { say(f.id ? 'Hindrance updated' : 'Hindrance recorded'); setF(EMPTY); reload(); }
  }

  async function close(h) {
    const d = window.prompt('Hindrance ended on (YYYY-MM-DD)', todayStr());
    if (!d) return;
    if (await act(() => must(supabase.from('hindrances').update({ to_date: d }).eq('id', h.id)))) reload();
  }

  async function remove(h) {
    if (!window.confirm(`Delete this hindrance entry?\n${h.reason}`)) return;
    if (await act(() => must(supabase.from('hindrances').delete().eq('id', h.id)))) reload();
  }

  if (!rows) return <Spinner />;
  const s = scheduleSummary(project, rows);
  const total = rows.reduce((t, h) => t + hindranceDays(h), 0);

  return (
    <>
      <ScheduleCards s={s} />
      {(!s.start || !s.agreed) && (
        <div className="small muted">Set the project start date and the completion date as per agreement in <b>Overview</b> to see the revised completion date.</div>
      )}
      <div className="small muted">
        Only hindrances caused by the <b>client</b> extend the completion date. Overlapping client entries are counted once.
        Clients can see this register on their Progress screen.
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Caused by</th><th /></tr></thead>
          <tbody>
            {rows.map((h, i) => (
              <tr key={h.id}>
                <td>{rows.length - i}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{longDate(h.from_date)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{h.to_date ? longDate(h.to_date) : <span className="pill due">Ongoing</span>}</td>
                <td>{hindranceDays(h)}</td>
                <td>{h.reason}{h.remarks && <div className="small muted">{h.remarks}</div>}</td>
                <td><span className={`pill ${h.caused_by === 'client' ? 'due' : 'upcoming'}`}>{CAUSES[h.caused_by]}</span></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {!h.to_date && <><button className="btn small" disabled={busy} onClick={() => close(h)}>Mark ended</button>{' '}</>}
                  <button className="btn ghost small" onClick={() => setF({ ...EMPTY, ...h, to_date: h.to_date || '', remarks: h.remarks || '' })}>Edit</button>{' '}
                  <button className="btn danger small" disabled={busy} onClick={() => remove(h)} aria-label="Delete hindrance"><Icon name="trash" size={16} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No hindrances recorded.</td></tr>}
            {rows.length > 0 && (
              <tr><td colSpan={3}><b>Total</b></td><td><b>{total}</b></td><td colSpan={3} className="small muted">of which client: {s.clientDays} days · others: {s.otherDays} days</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={save}>
        <div className="card-title">{f.id ? 'Edit hindrance' : 'Record a hindrance'}</div>
        <div className="form-grid">
          <label className="field"><span>From</span><input className="input" type="date" required value={f.from_date} onChange={set('from_date')} /></label>
          <label className="field"><span>To (leave empty if still going on)</span><input className="input" type="date" value={f.to_date} onChange={set('to_date')} /></label>
          <label className="field"><span>Caused by</span>
            <select className="select" value={f.caused_by} onChange={set('caused_by')}>
              {Object.entries(CAUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Reason for hindrance</span>
          <input className="input" required value={f.reason} onChange={set('reason')} placeholder="Tile selection pending from client" />
        </label>
        <label className="field"><span>Remarks (optional)</span>
          <input className="input" value={f.remarks} onChange={set('remarks')} placeholder="Reminded on WhatsApp 12 Nov and 15 Nov" />
        </label>
        <ErrorBox error={error} />
        <div className="toolbar">
          <button className="btn" disabled={busy}>{f.id ? 'Save changes' : 'Add to register'}</button>
          {f.id && <button type="button" className="btn ghost" onClick={() => setF(EMPTY)}>Cancel</button>}
        </div>
      </form>
    </>
  );
}
