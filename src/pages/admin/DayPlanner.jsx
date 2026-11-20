import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { addDays, todayStr } from '../../lib/schedule';
import { longDate, shortDate } from '../../lib/format';
import { tomorrowStr, dayName, planWorkers, boardSummary, TEAM_HINTS } from '../../lib/dayplan';
import { Spinner, ErrorBox, Icon, useToast } from '../../components/ui';
import { PhoneAlertsCard } from './StaffAlerts';
import { shareDayPlanPdf } from '../../lib/planPdf';

const STATUS = {
  submitted: { label: 'Waiting for review', cls: 'due' },
  approved: { label: 'Approved', cls: 'done' },
  changes: { label: 'Changes asked', cls: 'changes' },
};
const blankTask = () => ({ work: '', team: '', workers: '' });

export default function DayPlanner() {
  const { isAdmin, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const asked = params.get('date');
  const [date, setDate] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : tomorrowStr()));
  useEffect(() => { if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)) { setDate(asked); setParams({}, { replace: true }); } }, [asked, setParams]);
  const [projects, setProjects] = useState(null);
  const [plans, setPlans] = useState([]);
  const [week, setWeek] = useState([]);
  const [names, setNames] = useState({});
  const [editing, setEditing] = useState(null);      // { project, plan|null }
  const [error, setError] = useState(null);
  const [toast, say] = useToast();
  const today = todayStr();
  const past = date < today;

  const load = useCallback(async () => {
    setError(null);
    const [pr, pl, wk] = await Promise.all([
      supabase.from('projects').select('id, name, location, archived').order('created_at'),
      supabase.from('day_plans').select('*').eq('plan_date', date).order('created_at'),
      supabase.from('day_plans').select('id, project_id, plan_date, status').gte('plan_date', today).lte('plan_date', addDays(today, 6)),
    ]);
    if (pr.error || pl.error) setError(pr.error || pl.error);
    setProjects((pr.data || []).filter((p) => !p.archived));
    setPlans(pl.data || []);
    setWeek(wk.data || []);
  }, [date, today]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('profiles').select('id, full_name, role').then(({ data }) => {
      setNames(Object.fromEntries((data || []).map((p) => [p.id, p.full_name || 'Staff'])));
    });
  }, [isAdmin]);

  const siteName = useCallback((id) => projects?.find((p) => p.id === id)?.name || 'Site', [projects]);
  const summary = useMemo(() => boardSummary(plans, siteName), [plans, siteName]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);

  async function makePdf() {
    setPdfBusy(true);
    try {
      const r = await shareDayPlanPdf({ date, projects, plans, names, summary, siteName });
      if (r === 'downloaded') say('PDF downloaded');
    } catch (e) { setError(e); }
    setPdfBusy(false);
  }

  if (!projects) return <Spinner />;
  const plansFor = (pid) => plans.filter((p) => p.project_id === pid);
  const missing = projects.filter((p) => !plansFor(p.id).length);
  const done = () => { setEditing(null); load(); };

  return (
    <>
      <div className="between no-print-wrap">
        <div>
          <h1>Day planner</h1>
          <div className="small muted">{isAdmin ? 'Plans from all staff for every site. Only admins see this page in full.' : 'Fill in tomorrow’s plan for each of your sites every evening. Only the admin sees these plans.'}</div>
        </div>
        {isAdmin && (
          <div className="row no-print" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn small" disabled={pdfBusy} onClick={makePdf}>{pdfBusy ? 'Making PDF…' : 'PDF / Print / WhatsApp'}</button>
            {!standalone && <button className="btn small ghost" onClick={() => window.print()}>Print</button>}
          </div>
        )}
      </div>
      <div className="print-only" style={{ marginBottom: 8 }}><b>Day plan · {longDate(date)}</b></div>
      <ErrorBox error={error} />
      <PhoneAlertsCard compact />

      <DateBar date={date} setDate={(d) => { setEditing(null); setDate(d); }} today={today} />
      {isAdmin && <WeekStrip today={today} date={date} week={week} siteCount={projects.length} setDate={(d) => { setEditing(null); setDate(d); }} />}

      {isAdmin && (
        <div className="plan-stats">
          <Stat label="Sites planned" value={`${projects.length - missing.length} / ${projects.length}`} warn={missing.length > 0} />
          <Stat label="Workers planned" value={summary.workers} />
          <Stat label="Teams" value={summary.teams.length} />
          <Stat label="Clashes" value={summary.clashes.length} warn={summary.clashes.length > 0} />
        </div>
      )}

      {isAdmin && missing.length > 0 && (
        <div className="card pay-warn" style={{ alignItems: 'flex-start' }}>
          <Icon name="alert" />
          <div><b>No plan yet for {missing.length === 1 ? '1 site' : `${missing.length} sites`}</b>
            <div className="small">{missing.map((p) => p.name).join(' · ')}</div></div>
        </div>
      )}

      {isAdmin && summary.clashes.length > 0 && (
        <div className="card warn">
          <div className="card-title">Booked at more than one site</div>
          {summary.clashes.map((c) => (
            <div key={c.kind + c.name} className="small"><b>{c.kind}: {c.name}</b> — {c.sites.join(', ')}</div>
          ))}
          <div className="small muted">Check these before confirming. Same team names or machinery typed at two sites for the same day.</div>
        </div>
      )}

      <div className="plan-board">
        {projects.map((p) => {
          const list = plansFor(p.id);
          const mine = list.find((x) => x.created_by === user?.id);
          const isEditing = editing && editing.project.id === p.id;
          return (
            <section key={p.id} className="card plan-site">
              <div className="between">
                <div><div className="card-title">{p.name}</div><div className="small muted">{p.location || ''}</div></div>
                {!list.length && <span className="pill upcoming">{past ? 'No plan' : 'Not planned'}</span>}
              </div>

              {list.map((plan) => (isEditing && editing.plan?.id === plan.id ? null : (
                <PlanView key={plan.id} plan={plan} isAdmin={isAdmin} author={names[plan.created_by]}
                  canEdit={isAdmin || (!past && plan.created_by === user?.id)}
                  onEdit={() => setEditing({ project: p, plan })} onChanged={() => { load(); }} say={say} />
              )))}

              {isEditing ? (
                <PlanForm project={p} date={date} plan={editing.plan} isAdmin={isAdmin} say={say}
                  onDone={done} onCancel={() => setEditing(null)} />
              ) : (!past || isAdmin) && (!mine || isAdmin) && (
                <button className="btn small outline no-print" onClick={() => setEditing({ project: p, plan: isAdmin ? null : mine || null })}>
                  <Icon name="plus" size={18} /> {list.length ? 'Add another plan' : `Plan ${dayName(date).toLowerCase() === 'tomorrow' ? 'tomorrow' : 'this day'}`}
                </button>
              )}
            </section>
          );
        })}
        {!projects.length && <div className="card">No active projects.</div>}
      </div>

      {isAdmin && plans.length > 0 && <Rollups summary={summary} plans={plans} siteName={siteName} />}
      {toast}
    </>
  );
}

function Stat({ label, value, warn }) {
  return <div className={`card plan-stat${warn ? ' warn' : ''}`}><div className="small muted">{label}</div><div className="plan-stat-v">{value}</div></div>;
}

function DateBar({ date, setDate, today }) {
  return (
    <div className="card plan-datebar no-print">
      <button className="btn small ghost" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><Icon name="back" size={18} /></button>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div className="card-title">{dayName(date)}</div>
        <div className="small muted">{longDate(date)}</div>
      </div>
      <button className="btn small ghost" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><Icon name="chevron" size={18} /></button>
      <div className="row" style={{ gap: 6 }}>
        <button className={`btn small ${date === today ? '' : 'ghost'}`} onClick={() => setDate(today)}>Today</button>
        <button className={`btn small ${date === addDays(today, 1) ? '' : 'ghost'}`} onClick={() => setDate(addDays(today, 1))}>Tomorrow</button>
        <input type="date" className="input" style={{ height: 38, width: 150 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
    </div>
  );
}

function WeekStrip({ today, date, week, siteCount, setDate }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <div className="plan-week no-print">
      {days.map((d) => {
        const sites = new Set(week.filter((w) => w.plan_date === d).map((w) => w.project_id)).size;
        const full = siteCount && sites >= siteCount;
        return (
          <button key={d} className={`plan-day${d === date ? ' on' : ''}`} onClick={() => setDate(d)}>
            <span className="small">{d === today ? 'Today' : new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</span>
            <b>{shortDate(d)}</b>
            <span className={`small ${full ? 'green' : sites ? 'amber' : 'muted'}`}>{sites}/{siteCount} sites</span>
          </button>
        );
      })}
    </div>
  );
}

function PlanView({ plan, isAdmin, author, canEdit, onEdit, onChanged, say }) {
  const st = STATUS[plan.status] || STATUS.submitted;
  const [note, setNote] = useState(plan.admin_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tasks = (plan.tasks || []).filter((t) => t.work || t.team);

  async function review(status) {
    setBusy(true); setError(null);
    try {
      await must(supabase.from('day_plans').update({ status, admin_note: note.trim() }).eq('id', plan.id));
      say(status === 'approved' ? 'Plan approved' : 'Sent back for changes');
      onChanged();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Delete this plan?')) return;
    try { await must(supabase.from('day_plans').delete().eq('id', plan.id)); say('Plan deleted'); onChanged(); } catch (e) { setError(e); }
  }

  return (
    <div className="plan-view">
      <div className="between">
        <div className="small muted">
          {isAdmin && <><b style={{ color: 'var(--ink)' }}>{author || 'Staff'}</b> · </>}
          {plan.supervisor ? `In-charge: ${plan.supervisor}` : 'No in-charge named'}{plan.start_time ? ` · starts ${plan.start_time}` : ''}
        </div>
        <span className={`pill ${st.cls}`}>{st.label}</span>
      </div>

      {tasks.length ? (
        <table className="plan-tasks">
          <thead><tr><th>Work</th><th>Team</th><th style={{ textAlign: 'right' }}>Workers</th></tr></thead>
          <tbody>
            {tasks.map((t, i) => <tr key={i}><td>{t.work}</td><td>{t.team}</td><td style={{ textAlign: 'right' }}>{t.workers || ''}</td></tr>)}
            <tr className="tot"><td colSpan={2}>Total workers</td><td style={{ textAlign: 'right' }}>{planWorkers(plan)}</td></tr>
          </tbody>
        </table>
      ) : <div className="small muted">No works listed.</div>}

      {plan.materials && <Line label="Materials" text={plan.materials} />}
      {plan.equipment && <Line label="Machinery / tools" text={plan.equipment} />}
      {plan.remarks && <Line label="Remarks" text={plan.remarks} />}

      {!isAdmin && plan.admin_note && <div className="plan-note"><b>Admin:</b> {plan.admin_note}</div>}

      {isAdmin && (
        <div className="plan-review no-print">
          <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Note to staff (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button className="btn small" disabled={busy} onClick={() => review('approved')}>Approve</button>
            <button className="btn small ghost" disabled={busy} onClick={() => review('changes')}>Ask for changes</button>
            <span style={{ flex: 1 }} />
            {canEdit && <button className="btn small ghost" onClick={onEdit}>Edit</button>}
            <button className="btn small danger" onClick={remove}>Delete</button>
          </div>
        </div>
      )}
      {isAdmin && plan.admin_note && <div className="small muted print-only">Note: {plan.admin_note}</div>}
      {!isAdmin && canEdit && (
        <div className="row no-print" style={{ gap: 6 }}>
          <button className="btn small ghost" onClick={onEdit}>Edit plan</button>
          <button className="btn small danger" onClick={remove}>Delete</button>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

function Line({ label, text }) {
  return <div className="small"><span className="muted">{label}: </span><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>;
}

function PlanForm({ project, date, plan, isAdmin, say, onDone, onCancel }) {
  const [f, setF] = useState(() => ({
    supervisor: plan?.supervisor || '', start_time: plan?.start_time || '08:00',
    tasks: plan?.tasks?.length ? plan.tasks.map((t) => ({ ...blankTask(), ...t, workers: t.workers ?? '' })) : [blankTask(), blankTask()],
    materials: plan?.materials || '', equipment: plan?.equipment || '', remarks: plan?.remarks || '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setTask = (i, k) => (e) => setF({ ...f, tasks: f.tasks.map((t, j) => (j === i ? { ...t, [k]: e.target.value } : t)) });

  async function copyLast() {
    setError(null);
    const { data, error: e } = await supabase.from('day_plans').select('*').eq('project_id', project.id).lt('plan_date', date)
      .order('plan_date', { ascending: false }).limit(1);
    if (e) return setError(e);
    const last = data?.[0];
    if (!last) return setError(new Error('No earlier plan for this site to copy.'));
    setF({ supervisor: last.supervisor, start_time: last.start_time || '08:00',
      tasks: last.tasks?.length ? last.tasks.map((t) => ({ ...blankTask(), ...t })) : [blankTask()],
      materials: '', equipment: last.equipment, remarks: '' });
    say(`Copied from ${shortDate(last.plan_date)} — change what's different`);
  }

  async function save(e) {
    e.preventDefault();
    const tasks = f.tasks
      .map((t) => ({ work: t.work.trim(), team: t.team.trim(), workers: t.workers === '' ? null : Math.max(0, parseInt(t.workers, 10) || 0) }))
      .filter((t) => t.work || t.team);
    if (!tasks.length) return setError(new Error('Add at least one work for the day.'));
    const row = { supervisor: f.supervisor.trim(), start_time: f.start_time, tasks,
      materials: f.materials.trim(), equipment: f.equipment.trim(), remarks: f.remarks.trim() };
    setBusy(true); setError(null);
    try {
      if (plan) await must(supabase.from('day_plans').update(row).eq('id', plan.id));
      else await must(supabase.from('day_plans').insert({ ...row, project_id: project.id, plan_date: date }));
      say(plan ? 'Plan updated' : isAdmin ? 'Plan saved' : 'Plan sent to admin');
      onDone();
    } catch (err) {
      setError(/duplicate|unique/i.test(err.message || '') ? new Error('You already have a plan for this site on this day. Edit that one instead.') : err);
      setBusy(false);
    }
  }

  return (
    <form className="plan-form" onSubmit={save}>
      <div className="between">
        <b>{plan ? 'Edit plan' : 'New plan'} · {longDate(date)}</b>
        {!plan && <button type="button" className="btn small ghost" onClick={copyLast}>Copy last plan</button>}
      </div>
      <div className="grid2">
        <label className="field"><span>Site in-charge</span>
          <input className="input" placeholder="Supervisor / engineer" value={f.supervisor} onChange={set('supervisor')} /></label>
        <label className="field"><span>Work starts at</span>
          <input className="input" type="time" value={f.start_time} onChange={set('start_time')} /></label>
      </div>

      <div className="field"><span>Works planned</span>
        <datalist id="team-hints">{TEAM_HINTS.map((t) => <option key={t} value={t} />)}</datalist>
        {f.tasks.map((t, i) => (
          <div key={i} className="plan-task-row">
            <input className="input" placeholder="Work (e.g. first floor plastering, east wall)" value={t.work} onChange={setTask(i, 'work')} />
            <input className="input" list="team-hints" placeholder="Team / gang" value={t.team} onChange={setTask(i, 'team')} />
            <input className="input" type="number" min="0" inputMode="numeric" placeholder="Nos" value={t.workers} onChange={setTask(i, 'workers')} />
            <button type="button" className="btn small ghost" aria-label="Remove row" disabled={f.tasks.length === 1}
              onClick={() => setF({ ...f, tasks: f.tasks.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
          </div>
        ))}
        <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, tasks: [...f.tasks, blankTask()] })}>
          <Icon name="plus" size={16} /> Add work
        </button>
      </div>

      <label className="field"><span>Materials to deliver / keep ready</span>
        <textarea className="textarea" style={{ minHeight: 64 }} placeholder="Cement 60 bags, M-sand 1 load, 8 mm rods 20 nos" value={f.materials} onChange={set('materials')} /></label>
      <label className="field"><span>Machinery / tools / vehicles (comma separated)</span>
        <input className="input" placeholder="Concrete mixer, needle vibrator, scaffolding" value={f.equipment} onChange={set('equipment')} /></label>
      <label className="field"><span>Remarks</span>
        <input className="input" placeholder="Inspection at 11 am, client visit, power shutdown…" value={f.remarks} onChange={set('remarks')} /></label>

      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small" disabled={busy}>{busy ? 'Saving…' : plan ? 'Save changes' : isAdmin ? 'Save plan' : 'Send plan to admin'}</button>
        <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Rollups({ summary, plans, siteName }) {
  const materials = plans.filter((p) => p.materials);
  return (
    <div className="grid2 plan-rollups">
      <div className="card">
        <div className="card-title">Labour across sites</div>
        {summary.teams.length ? (
          <table className="plan-tasks">
            <thead><tr><th>Team</th><th>Sites</th><th style={{ textAlign: 'right' }}>Workers</th></tr></thead>
            <tbody>
              {summary.teams.map((t) => (
                <tr key={t.name} className={t.sites.length > 1 ? 'clash' : ''}><td>{t.name}</td><td>{t.sites.join(', ')}</td><td style={{ textAlign: 'right' }}>{t.workers || ''}</td></tr>
              ))}
              <tr className="tot"><td colSpan={2}>All sites</td><td style={{ textAlign: 'right' }}>{summary.workers}</td></tr>
            </tbody>
          </table>
        ) : <div className="small muted">No team names entered.</div>}
      </div>
      <div className="card">
        <div className="card-title">Materials & machinery to arrange</div>
        {materials.map((p) => <Line key={p.id} label={siteName(p.project_id)} text={p.materials} />)}
        {summary.equipment.length > 0 && (
          <div className="small"><span className="muted">Machinery: </span>
            {summary.equipment.map((e) => `${e.name}${e.sites.length > 1 ? ` (${e.sites.length} sites!)` : ''}`).join(', ')}</div>
        )}
        {!materials.length && !summary.equipment.length && <div className="small muted">Nothing listed.</div>}
      </div>
    </div>
  );
}
