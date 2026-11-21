// Weekly planner — one plan per site per week (Monday to Sunday).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { addDays, todayStr } from '../../lib/schedule';
import { Spinner, ErrorBox, Icon, useToast } from '../../components/ui';

const STATUS = {
  submitted: { label: 'Waiting for review', cls: 'due' },
  approved: { label: 'Approved', cls: 'done' },
  changes: { label: 'Changes asked', cls: 'changes' },
};
const DAY_HINTS = ['Mon–Sat', 'Mon–Wed', 'Thu–Sat', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const blankItem = () => ({ work: '', target: '', days: '', team: '' });
export const mondayOf = (d) => { const wd = new Date(d + 'T00:00:00').getDay(); return addDays(d, -((wd + 6) % 7)); };
const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const weekLabel = (w) => `${fmt(w)} – ${fmt(addDays(w, 6))}`;
// Fri–Sun open next week's plan; Mon–Thu open this week's
const defaultWeek = () => { const t = todayStr(); const wd = new Date(t + 'T00:00:00').getDay(); return addDays(mondayOf(t), [5, 6, 0].includes(wd) ? 7 : 0); };

export default function WeeklyPlanner() {
  const { isAdmin, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const asked = params.get('week');
  const valid = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w || '');
  const [week, setWeek] = useState(() => (valid(asked) ? mondayOf(asked) : defaultWeek()));
  useEffect(() => { if (valid(asked)) { setWeek(mondayOf(asked)); setParams({}, { replace: true }); } }, [asked, setParams]);
  const [projects, setProjects] = useState(null);
  const [plans, setPlans] = useState([]);
  const [names, setNames] = useState({});
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [toast, say] = useToast();
  const thisWeek = mondayOf(todayStr());
  const past = week < thisWeek;

  const load = useCallback(async () => {
    setError(null);
    const [pr, wp] = await Promise.all([
      supabase.from('projects').select('id, name, location, archived').order('created_at'),
      supabase.from('weekly_plans').select('*').eq('week_start', week).order('created_at'),
    ]);
    if (pr.error || wp.error) setError(pr.error || wp.error);
    setProjects((pr.data || []).filter((p) => !p.archived));
    setPlans(wp.data || []);
  }, [week]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').then(({ data }) => setNames(Object.fromEntries((data || []).map((p) => [p.id, p.full_name || 'Staff']))));
  }, []);

  const stats = useMemo(() => {
    if (!projects) return null;
    const ids = new Set(plans.map((p) => p.project_id));
    return { planned: projects.filter((p) => ids.has(p.id)).length, missing: projects.filter((p) => !ids.has(p.id)),
      waiting: plans.filter((p) => p.status === 'submitted').length, works: plans.reduce((s, p) => s + (p.items || []).filter((i) => i.work).length, 0) };
  }, [projects, plans]);

  if (!projects) return <Spinner />;
  const go = (w) => { setEditing(null); setWeek(w); };
  const done = () => { setEditing(null); load(); };

  return (
    <>
      <div>
        <h1>Weekly planner</h1>
        <div className="small muted">{isAdmin ? 'Next week’s plan for every site. Staff send them on Saturday; approve, ask for changes or edit here.' : 'Every Saturday, plan next week’s works for your sites. The admin approves them.'}</div>
      </div>
      <ErrorBox error={error} />
      <div className="card plan-datebar no-print">
        <button className="btn small ghost" aria-label="Previous week" onClick={() => go(addDays(week, -7))}><Icon name="back" size={18} /></button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="card-title">{week === thisWeek ? 'This week' : week === addDays(thisWeek, 7) ? 'Next week' : 'Week'}</div>
          <div className="small muted">{weekLabel(week)}</div>
        </div>
        <button className="btn small ghost" aria-label="Next week" onClick={() => go(addDays(week, 7))}><Icon name="chevron" size={18} /></button>
        <button className={`btn small ${week === thisWeek ? '' : 'ghost'}`} onClick={() => go(thisWeek)}>This week</button>
        <button className={`btn small ${week === addDays(thisWeek, 7) ? '' : 'ghost'}`} onClick={() => go(addDays(thisWeek, 7))}>Next week</button>
      </div>

      <div className="plan-stats">
        <div className={`card plan-stat${stats.missing.length ? ' warn' : ''}`}><div className="small muted">Sites planned</div><div className="plan-stat-v">{stats.planned} / {projects.length}</div></div>
        <div className="card plan-stat"><div className="small muted">Works planned</div><div className="plan-stat-v">{stats.works}</div></div>
        <div className={`card plan-stat${stats.waiting ? ' warn' : ''}`}><div className="small muted">Waiting for review</div><div className="plan-stat-v">{stats.waiting}</div></div>
        <div className="card plan-stat"><div className="small muted">Approved</div><div className="plan-stat-v">{plans.filter((p) => p.status === 'approved').length}</div></div>
      </div>
      {stats.missing.length > 0 && (
        <div className="card pay-warn" style={{ alignItems: 'flex-start' }}>
          <Icon name="alert" />
          <div><b>No weekly plan yet for {stats.missing.length === 1 ? '1 site' : `${stats.missing.length} sites`}</b>
            <div className="small">{stats.missing.map((p) => p.name).join(' · ')}</div></div>
        </div>
      )}

      <div className="plan-board">
        {projects.map((p) => {
          const list = plans.filter((x) => x.project_id === p.id);
          const mine = list.find((x) => x.created_by === user?.id);
          const isEditing = editing && editing.project.id === p.id;
          return (
            <section key={p.id} className="card plan-site">
              <div className="between">
                <div><div className="card-title">{p.name}</div><div className="small muted">{p.location || ''}</div></div>
                {!list.length && <span className="pill upcoming">Not planned</span>}
              </div>
              {list.map((plan) => (isEditing && editing.plan?.id === plan.id ? null : (
                <WeekView key={plan.id} plan={plan} isAdmin={isAdmin} author={names[plan.created_by]}
                  canEdit={isAdmin || (!past && plan.created_by === user?.id)} onEdit={() => setEditing({ project: p, plan })} onChanged={load} say={say} />
              )))}
              {isEditing ? (
                <WeekForm project={p} week={week} plan={editing.plan} isAdmin={isAdmin} say={say}
                  author={editing.plan && editing.plan.created_by !== user?.id ? names[editing.plan.created_by] || 'the staff member' : null}
                  onDone={done} onCancel={() => setEditing(null)} />
              ) : (!past || isAdmin) && (!mine || isAdmin) && (
                <button className="btn small outline no-print" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ project: p, plan: null })}>
                  <Icon name="plus" size={18} /> {list.length ? 'Add another plan' : 'Plan this week'}
                </button>
              )}
            </section>
          );
        })}
      </div>
      {toast}
    </>
  );
}

function WeekView({ plan, isAdmin, author, canEdit, onEdit, onChanged, say }) {
  const st = STATUS[plan.status] || STATUS.submitted;
  const [note, setNote] = useState(plan.admin_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, msg) => { setBusy(true); setError(null); try { await fn(); say(msg); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const items = (plan.items || []).filter((i) => i.work);
  return (
    <div className="plan-view">
      <div className="between">
        <div className="small muted"><b style={{ color: 'var(--ink)' }}>{author || 'Staff'}</b></div>
        <span className={`pill ${st.cls}`}>{st.label}</span>
      </div>
      {items.length ? (
        <table className="plan-tasks">
          <thead><tr><th>Work</th><th>Target</th><th>Days</th><th>Team</th></tr></thead>
          <tbody>{items.map((i, k) => <tr key={k}><td>{i.work}</td><td>{i.target}</td><td>{i.days}</td><td>{i.team}</td></tr>)}</tbody>
        </table>
      ) : <div className="small muted">No works listed.</div>}
      {plan.materials && <div className="small"><span className="muted">Materials for the week: </span><span style={{ whiteSpace: 'pre-wrap' }}>{plan.materials}</span></div>}
      {plan.remarks && <div className="small"><span className="muted">Remarks: </span>{plan.remarks}</div>}
      {plan.changed_at && <div className="plan-changed">Changed by admin · {new Date(plan.changed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</div>}
      {!isAdmin && plan.admin_note && <div className="plan-note"><b>Admin:</b> {plan.admin_note}</div>}
      {isAdmin && (
        <div className="plan-review no-print">
          <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Note to staff (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button className="btn small" disabled={busy} onClick={() => run(() => must(supabase.from('weekly_plans').update({ status: 'approved', admin_note: note.trim() }).eq('id', plan.id)), 'Weekly plan approved')}>Approve</button>
            <button className="btn small ghost" disabled={busy} onClick={() => run(() => must(supabase.from('weekly_plans').update({ status: 'changes', admin_note: note.trim() }).eq('id', plan.id)), 'Sent back for changes')}>Ask for changes</button>
            <span style={{ flex: 1 }} />
            <button className="btn small ghost" onClick={onEdit}>Edit</button>
            <button className="btn small danger" disabled={busy} onClick={() => window.confirm('Delete this weekly plan?') && run(() => must(supabase.from('weekly_plans').delete().eq('id', plan.id)), 'Deleted')}>Delete</button>
          </div>
        </div>
      )}
      {!isAdmin && canEdit && (
        <div className="row no-print" style={{ gap: 6 }}>
          <button className="btn small ghost" onClick={onEdit}>Edit plan</button>
          <button className="btn small danger" disabled={busy} onClick={() => window.confirm('Delete this weekly plan?') && run(() => must(supabase.from('weekly_plans').delete().eq('id', plan.id)), 'Deleted')}>Delete</button>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

function WeekForm({ project, week, plan, isAdmin, author, say, onDone, onCancel }) {
  const [f, setF] = useState(() => ({
    items: plan?.items?.length ? plan.items.map((i) => ({ ...blankItem(), ...i })) : [blankItem(), blankItem(), blankItem()],
    materials: plan?.materials || '', remarks: plan?.remarks || '', note: plan?.admin_note || '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setItem = (i, k) => (e) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) });

  async function copyLast() {
    setError(null);
    const { data, error: e } = await supabase.from('weekly_plans').select('*').eq('project_id', project.id).lt('week_start', week)
      .order('week_start', { ascending: false }).limit(1);
    if (e) return setError(e);
    const last = data?.[0];
    if (!last) return setError(new Error('No earlier weekly plan for this site to copy.'));
    setF({ ...f, items: last.items?.length ? last.items.map((i) => ({ ...blankItem(), ...i })) : [blankItem()], materials: last.materials || '' });
    say(`Copied from the week of ${fmt(last.week_start)} — change what's different`);
  }

  async function save(e) {
    e.preventDefault();
    const items = f.items.map((i) => ({ work: i.work.trim(), target: i.target.trim(), days: i.days.trim(), team: i.team.trim() })).filter((i) => i.work);
    if (!items.length) return setError(new Error('Add at least one work for the week.'));
    const row = { items, materials: f.materials.trim(), remarks: f.remarks.trim() };
    if (isAdmin && author) row.admin_note = f.note.trim();
    setBusy(true); setError(null);
    try {
      if (plan) await must(supabase.from('weekly_plans').update(row).eq('id', plan.id));
      else await must(supabase.from('weekly_plans').insert({ ...row, project_id: project.id, week_start: week }));
      say(plan ? (isAdmin && author ? `Plan changed — ${author} has been told` : 'Weekly plan updated') : isAdmin ? 'Weekly plan saved' : 'Weekly plan sent to admin');
      onDone();
    } catch (err) {
      setError(/duplicate|unique/i.test(err.message || '') ? new Error('You already have a plan for this site this week. Edit that one instead.') : err);
      setBusy(false);
    }
  }

  return (
    <form className="plan-form" onSubmit={save}>
      <div className="between">
        <b>{plan ? 'Edit weekly plan' : 'Weekly plan'} · {weekLabel(week)}</b>
        {!plan && <button type="button" className="btn small ghost" onClick={copyLast}>Copy last week</button>}
      </div>
      <div className="field"><span>Works for the week</span>
        <datalist id="week-days">{DAY_HINTS.map((d) => <option key={d} value={d} />)}</datalist>
        {f.items.map((i, k) => (
          <div key={k} className="week-row">
            <input className="input" placeholder="Work (e.g. first floor slab shuttering)" value={i.work} onChange={setItem(k, 'work')} />
            <input className="input" placeholder="Target (e.g. 120 sqm, 100%)" value={i.target} onChange={setItem(k, 'target')} />
            <input className="input" list="week-days" placeholder="Days" value={i.days} onChange={setItem(k, 'days')} />
            <input className="input" placeholder="Team" value={i.team} onChange={setItem(k, 'team')} />
            <button type="button" className="btn small ghost" aria-label="Remove row" disabled={f.items.length === 1}
              onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== k) })}><Icon name="close" size={16} /></button>
          </div>
        ))}
        <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, items: [...f.items, blankItem()] })}><Icon name="plus" size={16} /> Add work</button>
      </div>
      <label className="field"><span>Materials needed this week</span>
        <textarea className="textarea" style={{ minHeight: 64 }} placeholder="Cement 300 bags, 12 mm rods 2 t, M-sand 4 loads" value={f.materials} onChange={set('materials')} /></label>
      <label className="field"><span>Remarks</span>
        <input className="input" placeholder="Slab concreting planned Thursday, client visit Saturday…" value={f.remarks} onChange={set('remarks')} /></label>
      {isAdmin && author && (
        <label className="field"><span>What changed? (sent to {author})</span>
          <input className="input" placeholder="e.g. Move concreting to Friday" value={f.note} onChange={set('note')} /></label>
      )}
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small" disabled={busy}>{busy ? 'Saving…' : plan ? 'Save changes' : isAdmin ? 'Save plan' : 'Send plan to admin'}</button>
        <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
