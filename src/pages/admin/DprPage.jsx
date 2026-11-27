// Evening DPR (daily progress report) — internal, staff only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { addDays, todayStr } from '../../lib/schedule';
import { longDate } from '../../lib/format';
import { dayName } from '../../lib/dayplan';
import { Spinner, ErrorBox, Icon, useToast } from '../../components/ui';
import { changeText } from './DayChanges';
import { shareDprPdf } from '../../lib/planPdf';

const WORK_STATUS = { done: 'Done', partly: 'Partly done', not_done: 'Not done', extra: 'Extra work' };
const labourTotal = (r) => (r.labour || []).reduce((s, l) => s + (parseInt(l.count, 10) || 0), 0);
const fmtTime = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export default function DprPage() {
  const { isAdmin, isPm, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const asked = params.get('date');
  const [date, setDate] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : todayStr()));
  useEffect(() => { if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)) { setDate(asked); setParams({}, { replace: true }); } }, [asked, setParams]);
  const [data, setData] = useState(null);
  const [names, setNames] = useState({});
  const [editing, setEditing] = useState(null);       // { project, dpr|null }
  const [error, setError] = useState(null);
  const [toast, say] = useToast();
  const today = todayStr();

  const load = useCallback(async () => {
    setError(null);
    const [pr, dp, rp, lv, ch, cr] = await Promise.all([
      supabase.from('projects').select('id, name, location, archived, pm_id').order('created_at'),
      supabase.from('day_plans').select('*').eq('plan_date', date),
      supabase.from('dprs').select('*').eq('report_date', date).order('created_at'),
      supabase.from('site_leaves').select('project_id, reason, status').eq('leave_date', date).eq('status', 'approved'),
      supabase.from('day_changes').select('*').eq('change_date', date).neq('status', 'rejected'),
      supabase.from('dpr_reports').select('*').eq('report_date', date).maybeSingle(),
    ]);
    if (pr.error || rp.error) setError(pr.error || rp.error);
    setData({ projects: (pr.data || []).filter((p) => !p.archived), plans: dp.data || [], dprs: rp.data || [], leaves: lv.data || [], changes: ch.data || [], report: cr.data || null });
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').then(({ data: d }) => setNames(Object.fromEntries((d || []).map((p) => [p.id, p.full_name || 'Staff']))));
  }, []);

  const siteName = useCallback((id) => data?.projects.find((p) => p.id === id)?.name || 'Site', [data]);
  const view = useMemo(() => {
    if (!data) return null;
    const off = new Set(data.leaves.map((l) => l.project_id));
    const plannedIds = new Set(data.plans.map((p) => p.project_id));
    const planned = data.projects.filter((p) => plannedIds.has(p.id) && !off.has(p.id));
    const others = data.projects.filter((p) => !plannedIds.has(p.id) && !off.has(p.id));
    const withDpr = new Set(data.dprs.map((r) => r.project_id));
    return { off, planned, others, missing: planned.filter((p) => !withDpr.has(p.id)),
      received: planned.filter((p) => withDpr.has(p.id)).length,
      workers: data.dprs.reduce((s, r) => s + labourTotal(r), 0),
      issues: data.dprs.filter((r) => r.issues).length };
  }, [data]);

  if (!data) return <Spinner />;
  const done = () => { setEditing(null); load(); };
  const card = (p) => {
    const here = isAdmin || (isPm && p.pm_id === user?.id);
    const list = data.dprs.filter((r) => r.project_id === p.id);
    const mine = list.find((r) => r.created_by === user?.id);
    const plan = data.plans.filter((x) => x.project_id === p.id);
    const isEditing = editing && editing.project.id === p.id;
    const canWrite = here || (date <= today && date >= addDays(today, -1));
    return (
      <section key={p.id} className="card plan-site">
        <div className="between">
          <div><div className="card-title">{p.name}</div><div className="small muted">{p.location || ''}</div></div>
          {list.length ? <span className="pill done">DPR received</span> : plan.length ? <span className="pill due">DPR pending</span> : null}
        </div>
        {plan.length > 0 && !list.length && !isEditing && (
          <div className="small muted">Planned: {plan.flatMap((x) => (x.tasks || []).map((t) => t.work).filter(Boolean)).join(' · ') || '—'}</div>
        )}
        {list.map((r) => (isEditing && editing.dpr?.id === r.id ? null : (
          <DprView key={r.id} r={r} isAdmin={here} author={names[r.created_by]}
            canEdit={here || (r.created_by === user?.id && date >= addDays(today, -1))}
            onEdit={() => setEditing({ project: p, dpr: r })} onChanged={load} say={say} />
        )))}
        {isEditing ? (
          <DprForm project={p} date={date} dpr={editing.dpr} plans={plan} isAdmin={here} say={say}
            changes={data.changes.filter((c) => c.project_id === p.id || c.to_project_id === p.id)} siteName={siteName}
            onDone={done} onCancel={() => setEditing(null)} />
        ) : canWrite && (!mine || here) && (
          <button className="btn small outline no-print" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ project: p, dpr: null })}>
            <Icon name="plus" size={18} /> {list.length ? 'Add another DPR' : 'Write DPR'}
          </button>
        )}
      </section>
    );
  };

  return (
    <>
      <div>
        <h1>Daily progress report (DPR)</h1>
        <div className="small muted">Send the DPR for each site you worked on, every evening. Staff only — clients don't see it.</div>
      </div>
      <ErrorBox error={error} />
      <div className="card plan-datebar no-print">
        <button className="btn small ghost" aria-label="Previous day" onClick={() => { setEditing(null); setDate(addDays(date, -1)); }}><Icon name="back" size={18} /></button>
        <div style={{ flex: 1, textAlign: 'center' }}><div className="card-title">{dayName(date)}</div><div className="small muted">{longDate(date)}</div></div>
        <button className="btn small ghost" aria-label="Next day" disabled={date >= today} onClick={() => { setEditing(null); setDate(addDays(date, 1)); }}><Icon name="chevron" size={18} /></button>
        <button className={`btn small ${date === today ? '' : 'ghost'}`} onClick={() => { setEditing(null); setDate(today); }}>Today</button>
        <input type="date" className="input" style={{ height: 38, width: 150 }} max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>

      <Consolidated date={date} data={data} view={view} names={names} isAdmin={isAdmin} today={today} say={say} onSent={load} />

      <div className="plan-stats">
        <div className={`card plan-stat${view.missing.length ? ' warn' : ''}`}><div className="small muted">DPRs received</div><div className="plan-stat-v">{view.received} / {view.planned.length}</div></div>
        <div className="card plan-stat"><div className="small muted">Workers reported</div><div className="plan-stat-v">{view.workers}</div></div>
        <div className={`card plan-stat${view.issues ? ' warn' : ''}`}><div className="small muted">Reports with issues</div><div className="plan-stat-v">{view.issues}</div></div>
        <div className="card plan-stat"><div className="small muted">Sites off</div><div className="plan-stat-v">{view.off.size}</div></div>
      </div>
      {view.missing.length > 0 && (
        <div className="card pay-warn" style={{ alignItems: 'flex-start' }}>
          <Icon name="alert" />
          <div><b>No DPR yet for {view.missing.length === 1 ? '1 planned site' : `${view.missing.length} planned sites`}</b>
            <div className="small">{view.missing.map((p) => p.name).join(' · ')}</div></div>
        </div>
      )}

      <div className="plan-board">
        {view.planned.map(card)}
        {!view.planned.length && <div className="card small muted">No sites were planned for this day. You can still write a DPR for any site below.</div>}
      </div>
      {view.others.length > 0 && (
        <details className="card" style={{ gap: 10 }}>
          <summary className="card-title" style={{ cursor: 'pointer' }}>Other sites (not in the day plan) · {view.others.length}</summary>
          <div className="plan-board" style={{ marginTop: 10 }}>{view.others.map(card)}</div>
        </details>
      )}
      {toast}
    </>
  );
}

function Consolidated({ date, data, view, names, isAdmin, today, say, onSent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const r = data.report;
  const sites = view.planned.filter((p) => data.dprs.some((d) => d.project_id === p.id));
  const extra = data.projects.filter((p) => !view.planned.includes(p) && data.dprs.some((d) => d.project_id === p.id));
  const all = [...sites, ...extra];
  const offSites = data.leaves.map((l) => ({ name: data.projects.find((p) => p.id === l.project_id)?.name || 'Site', reason: l.reason }));
  const changedAfter = r && data.dprs.some((d) => new Date(d.updated_at || d.created_at) > new Date(r.sent_at));
  const canSend = isAdmin || (date <= today && date >= addDays(today, -1));
  const sentText = (rep) => `Sent by ${names[rep.sent_by] || 'staff'} · ${rep.sent_at ? fmtTime(rep.sent_at) : 'just now'}`;
  const pdf = (rep) => shareDprPdf({ date, sites: all, dprs: data.dprs, names, offSites, sentText: rep ? sentText(rep) : '' });

  async function send() {
    setBusy(true); setError(null);
    try {
      const rep = await must(supabase.from('dpr_reports').upsert({ report_date: date }, { onConflict: 'report_date' }).select().single());
      say(r ? 'Consolidated DPR sent again' : 'Consolidated DPR sent to admin');
      const how = await pdf(rep);
      if (how === 'downloaded') say('Consolidated DPR sent · PDF downloaded');
      onSent();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function share() {
    setBusy(true); setError(null);
    try { await pdf(r); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (!view.planned.length && !data.dprs.length) return null;
  return (
    <div className={`card day-approval ${r && !changedAfter ? 'ok' : 'warn'} no-print`}>
      <Icon name={r && !changedAfter ? 'check' : 'alert'} />
      <div style={{ flex: 1 }} className="small">
        <b>Consolidated DPR · {dayName(date)}</b>
        {r ? (
          <div>{sentText(r)} · {r.sites} sites · {r.workers} workers · {r.issues ? `${r.issues} with issues` : 'no issues'}{r.times_sent > 1 ? ` · sent ${r.times_sent} times` : ''}
            {changedAfter && <div><b>A site DPR changed after sending.</b> Send it again so the admin gets the latest.</div>}</div>
        ) : view.missing.length ? (
          <div>Write the DPR for every planned site first. Still missing: {view.missing.map((p) => p.name).join(', ')}.</div>
        ) : (
          <div>All {view.planned.length} site DPRs are in. Send the consolidated DPR to the admin.</div>
        )}
        <ErrorBox error={error} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {canSend && (!r || changedAfter) && (
          <button className="btn small" disabled={busy || view.missing.length > 0} onClick={send}>{busy ? 'Sending…' : r ? 'Send again' : 'Send consolidated DPR'}</button>
        )}
        {r && <button className="btn small ghost" disabled={busy} onClick={share}>PDF / WhatsApp</button>}
      </div>
    </div>
  );
}

function DprView({ r, isAdmin, author, canEdit, onEdit, onChanged, say }) {
  const [note, setNote] = useState(r.admin_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, msg) => { setBusy(true); setError(null); try { await fn(); say(msg); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const works = (r.works || []).filter((w) => w.work);
  const labour = (r.labour || []).filter((l) => l.trade || l.count);
  return (
    <div className="plan-view">
      <div className="between">
        <div className="small muted"><b style={{ color: 'var(--ink)' }}>{author || 'Staff'}</b> · sent {fmtTime(r.updated_at || r.created_at)}</div>
        <span className={`pill ${r.status === 'reviewed' ? 'done' : 'due'}`}>{r.status === 'reviewed' ? 'Reviewed' : 'Sent'}</span>
      </div>
      {works.length > 0 && (
        <table className="plan-tasks">
          <thead><tr><th>Work</th><th>Status</th><th>Qty / progress</th></tr></thead>
          <tbody>{works.map((w, i) => (
            <tr key={i}><td>{w.work}{w.remarks ? <div className="small muted">{w.remarks}</div> : null}</td>
              <td><span className={`dpr-st ${w.status}`}>{WORK_STATUS[w.status] || w.status}</span></td><td>{w.qty}</td></tr>
          ))}</tbody>
        </table>
      )}
      {labour.length > 0 && <div className="small"><span className="muted">Labour: </span>{labour.map((l) => `${l.trade || 'Workers'} ${l.count || 0}`).join(' · ')} · <b>Total {labourTotal(r)}</b></div>}
      {r.materials_received && <Line label="Materials received" text={r.materials_received} />}
      {r.materials_used && <Line label="Materials used" text={r.materials_used} />}
      {r.machinery && <Line label="Machinery used" text={r.machinery} />}
      {r.issues && <div className="plan-changed" style={{ whiteSpace: 'pre-wrap' }}>Issues: {r.issues}</div>}
      {r.next_day && <Line label="Next day" text={r.next_day} />}
      {!isAdmin && r.admin_note && <div className="plan-note"><b>Admin:</b> {r.admin_note}</div>}
      {isAdmin && (
        <div className="plan-review no-print">
          <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Note to staff (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {r.status !== 'reviewed' && <button className="btn small" disabled={busy} onClick={() => run(() => must(supabase.from('dprs').update({ status: 'reviewed', admin_note: note.trim() }).eq('id', r.id)), 'Marked reviewed')}>Mark reviewed</button>}
            <span style={{ flex: 1 }} />
            <button className="btn small ghost" onClick={onEdit}>Edit</button>
            <button className="btn small danger" disabled={busy} onClick={() => window.confirm('Delete this DPR?') && run(() => must(supabase.from('dprs').delete().eq('id', r.id)), 'DPR deleted')}>Delete</button>
          </div>
        </div>
      )}
      {!isAdmin && canEdit && (
        <div className="row no-print" style={{ gap: 6 }}>
          <button className="btn small ghost" onClick={onEdit}>Edit DPR</button>
          <button className="btn small danger" disabled={busy} onClick={() => window.confirm('Delete this DPR?') && run(() => must(supabase.from('dprs').delete().eq('id', r.id)), 'DPR deleted')}>Delete</button>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

function Line({ label, text }) {
  return <div className="small"><span className="muted">{label}: </span><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>;
}

function DprForm({ project, date, dpr, plans, isAdmin, changes, siteName, say, onDone, onCancel }) {
  const [f, setF] = useState(() => {
    if (dpr) return { works: dpr.works?.length ? dpr.works : [{ work: '', status: 'done', qty: '', remarks: '' }], labour: dpr.labour?.length ? dpr.labour : [{ trade: '', count: '' }],
      materials_received: dpr.materials_received, materials_used: dpr.materials_used, machinery: dpr.machinery, issues: dpr.issues, next_day: dpr.next_day };
    const tasks = plans.flatMap((p) => p.tasks || []).filter((t) => t.work || t.team);
    const hindrances = changes.filter((c) => c.kind === 'hindrance' && c.project_id === project.id).map((c) => changeText(c, siteName, project.id));
    return {
      works: tasks.length ? tasks.map((t) => ({ work: t.work || '', status: 'done', qty: '', remarks: '' })) : [{ work: '', status: 'done', qty: '', remarks: '' }],
      labour: tasks.filter((t) => t.team || t.workers).length ? tasks.filter((t) => t.team || t.workers).map((t) => ({ trade: t.team || '', count: t.workers ?? '' })) : [{ trade: '', count: '' }],
      materials_received: '', materials_used: '', machinery: plans.map((p) => p.equipment).filter(Boolean).join(', '),
      issues: hindrances.join('\n'), next_day: '',
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setRow = (key, i, k) => (e) => setF({ ...f, [key]: f[key].map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) });
  const addRow = (key, row) => setF({ ...f, [key]: [...f[key], row] });
  const delRow = (key, i) => setF({ ...f, [key]: f[key].filter((_, j) => j !== i) });
  const shifts = changes.filter((c) => c.kind !== 'hindrance');

  async function save(e) {
    e.preventDefault();
    const works = f.works.map((w) => ({ work: w.work.trim(), status: w.status, qty: (w.qty || '').trim(), remarks: (w.remarks || '').trim() })).filter((w) => w.work);
    if (!works.length) return setError(new Error('Add at least one work done today.'));
    const labour = f.labour.map((l) => ({ trade: (l.trade || '').trim(), count: l.count === '' ? null : Math.max(0, parseInt(l.count, 10) || 0) })).filter((l) => l.trade || l.count);
    const row = { works, labour, materials_received: f.materials_received.trim(), materials_used: f.materials_used.trim(),
      machinery: f.machinery.trim(), issues: f.issues.trim(), next_day: f.next_day.trim() };
    setBusy(true); setError(null);
    try {
      if (dpr) await must(supabase.from('dprs').update(row).eq('id', dpr.id));
      else await must(supabase.from('dprs').insert({ ...row, project_id: project.id, report_date: date }));
      say(dpr ? 'DPR updated' : isAdmin ? 'DPR saved' : 'DPR sent to admin');
      onDone();
    } catch (err) {
      setError(/duplicate|unique/i.test(err.message || '') ? new Error('You already sent a DPR for this site today. Edit that one instead.') : err);
      setBusy(false);
    }
  }

  return (
    <form className="plan-form" onSubmit={save}>
      <b>{dpr ? 'Edit DPR' : 'DPR'} · {project.name} · {longDate(date)}</b>
      {shifts.length > 0 && <div className="small muted">Shifts today: {shifts.map((c) => changeText(c, siteName, project.id)).join(' · ')}</div>}

      <div className="field"><span>Works today</span>
        {f.works.map((w, i) => (
          <div key={i} className="dpr-work-row">
            <input className="input" placeholder="Work" value={w.work} onChange={setRow('works', i, 'work')} />
            <select className="input" value={w.status} onChange={setRow('works', i, 'status')}>
              {Object.entries(WORK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input" placeholder="Qty / % (e.g. 40 sqm, 60%)" value={w.qty} onChange={setRow('works', i, 'qty')} />
            <input className="input" placeholder="Remarks / reason if not done" value={w.remarks} onChange={setRow('works', i, 'remarks')} />
            <button type="button" className="btn small ghost" aria-label="Remove" disabled={f.works.length === 1} onClick={() => delRow('works', i)}><Icon name="close" size={16} /></button>
          </div>
        ))}
        <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addRow('works', { work: '', status: 'extra', qty: '', remarks: '' })}><Icon name="plus" size={16} /> Add work</button>
      </div>

      <div className="field"><span>Labour present (by trade / team)</span>
        {f.labour.map((l, i) => (
          <div key={i} className="dpr-labour-row">
            <input className="input" list="dpr-trades" placeholder="Masons / Helpers / Rajan team" value={l.trade} onChange={setRow('labour', i, 'trade')} />
            <input className="input" type="number" min="0" inputMode="numeric" placeholder="Nos" value={l.count ?? ''} onChange={setRow('labour', i, 'count')} />
            <button type="button" className="btn small ghost" aria-label="Remove" disabled={f.labour.length === 1} onClick={() => delRow('labour', i)}><Icon name="close" size={16} /></button>
          </div>
        ))}
        <datalist id="dpr-trades">{['Masons', 'Helpers', 'Carpenters', 'Bar benders', 'Electricians', 'Plumbers', 'Painters', 'Tile layers'].map((t) => <option key={t} value={t} />)}</datalist>
        <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addRow('labour', { trade: '', count: '' })}><Icon name="plus" size={16} /> Add trade</button>
      </div>

      <div className="grid2">
        <label className="field"><span>Materials received</span><textarea className="textarea" style={{ minHeight: 56 }} placeholder="Cement 50 bags, M-sand 1 load" value={f.materials_received} onChange={set('materials_received')} /></label>
        <label className="field"><span>Materials used</span><textarea className="textarea" style={{ minHeight: 56 }} placeholder="Cement 32 bags" value={f.materials_used} onChange={set('materials_used')} /></label>
      </div>
      <label className="field"><span>Machinery used</span><input className="input" placeholder="Concrete mixer, vibrator" value={f.machinery} onChange={set('machinery')} /></label>
      <label className="field"><span>Issues / hindrances / safety</span><textarea className="textarea" style={{ minHeight: 56 }} placeholder="Anything that stopped or slowed work" value={f.issues} onChange={set('issues')} /></label>
      <label className="field"><span>Plan for next day</span><input className="input" placeholder="Continue plastering east wall" value={f.next_day} onChange={set('next_day')} /></label>
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small" disabled={busy}>{busy ? 'Saving…' : dpr ? 'Save changes' : isAdmin ? 'Save DPR' : 'Send DPR'}</button>
        <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
