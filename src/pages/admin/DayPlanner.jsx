import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { addDays, todayStr } from '../../lib/schedule';
import { longDate, shortDate } from '../../lib/format';
import { tomorrowStr, dayName, planWorkers, boardSummary, TEAM_HINTS } from '../../lib/dayplan';
import { Spinner, ErrorBox, Icon, useToast } from '../../components/ui';
import { PhoneAlertsCard } from './StaffAlerts';
import { shareDayPlanPdf, pdfHeading } from '../../lib/planPdf';
import { SiteChanges, changeText } from './DayChanges';

const STATUS = {
  submitted: { label: 'Waiting for review', cls: 'due' },
  approved: { label: 'Approved', cls: 'done' },
  changes: { label: 'Changes asked', cls: 'changes' },
};
const blankTask = () => ({ work: '', team: '', workers: '' });
// Mornings (before 12 noon India time) open on today's plan, afternoons on tomorrow's
const defaultDay = () => (Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })) < 12 ? todayStr() : tomorrowStr());

export default function DayPlanner() {
  const { isAdmin, isSuper, isPm, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const asked = params.get('date');
  const [date, setDate] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : defaultDay()));
  useEffect(() => { if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)) { setDate(asked); setParams({}, { replace: true }); } }, [asked, setParams]);
  const [projects, setProjects] = useState(null);
  const [plans, setPlans] = useState([]);
  const [week, setWeek] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [approval, setApproval] = useState(null);
  const [lock, setLock] = useState(null);
  const [changes, setChanges] = useState([]);
  const [names, setNames] = useState({});
  const [editing, setEditing] = useState(null);      // { project, plan|null }
  const [error, setError] = useState(null);
  const [toast, say] = useToast();
  const today = todayStr();
  const past = date < today;

  const load = useCallback(async () => {
    setError(null);
    const [pr, pl, wk, lv, wl, ap, ch, lk] = await Promise.all([
      supabase.from('projects').select('id, name, location, archived, pm_id').order('created_at'),
      supabase.from('day_plans').select('*').eq('plan_date', date).order('created_at'),
      supabase.from('day_plans').select('id, project_id, plan_date, status').gte('plan_date', today).lte('plan_date', addDays(today, 6)),
      supabase.from('site_leaves').select('*').eq('leave_date', date),
      supabase.from('site_leaves').select('project_id, leave_date, status').gte('leave_date', today).lte('leave_date', addDays(today, 6)),
      supabase.from('day_approvals').select('*').eq('plan_date', date).maybeSingle(),
      supabase.from('day_changes').select('*').eq('change_date', date).order('created_at'),
      supabase.from('day_locks').select('*').eq('plan_date', date).maybeSingle(),
    ]);
    if (pr.error || pl.error || lv.error) setError(pr.error || pl.error || lv.error);
    setProjects((pr.data || []).filter((p) => !p.archived));
    setPlans(pl.data || []);
    setLeaves(lv.data || []);
    setApproval(ap.data || null);
    setChanges(ch.data || []);
    setLock(lk.data || null);
    setWeek([...(wk.data || []), ...(wl.data || []).filter((l) => l.status !== 'rejected').map((l) => ({ project_id: l.project_id, plan_date: l.leave_date }))]);
  }, [date, today]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, role').then(({ data }) => {
      setNames(Object.fromEntries((data || []).map((p) => [p.id, p.full_name || 'Staff'])));
    });
  }, []);

  const siteName = useCallback((id) => projects?.find((p) => p.id === id)?.name || 'Site', [projects]);
  const offIds = useMemo(() => new Set(leaves.filter((l) => l.status === 'approved').map((l) => l.project_id)), [leaves]);
  const workingPlans = useMemo(() => plans.filter((p) => !offIds.has(p.project_id)), [plans, offIds]);
  const summary = useMemo(() => boardSummary(workingPlans, siteName), [workingPlans, siteName]);
  const locked = !isAdmin && !approval;
  const [pdfBusy, setPdfBusy] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);

  async function makePdf() {
    setPdfBusy(true);
    try {
      if (locked) throw new Error('The PDF unlocks after the admin approves this day.');
      const offSites = leaves.filter((l) => l.status === 'approved').map((l) => ({ name: siteName(l.project_id), reason: l.reason }));
      const approvedText = approval ? `Approved by ${names[approval.approved_by] || 'admin'}, ${fmtTime(approval.approved_at)}` : 'Not yet approved by admin';
      const changeLines = changes.filter((c) => c.status !== 'rejected').map((c) => `${siteName(c.project_id)}: ${changeText(c, siteName, c.project_id)}`);
      const r = await shareDayPlanPdf({ date, projects: projects.filter((p) => !offIds.has(p.id)), plans: workingPlans, names, summary, siteName, offSites, approvedText, changeLines });
      if (r === 'downloaded') say('PDF downloaded');
    } catch (e) { setError(e); }
    setPdfBusy(false);
  }

  if (!projects) return <Spinner />;
  const plansFor = (pid) => plans.filter((p) => p.project_id === pid);
  const leaveFor = (pid) => leaves.find((l) => l.project_id === pid);
  const missing = projects.filter((p) => !plansFor(p.id).length && !(leaveFor(p.id) && leaveFor(p.id).status !== 'rejected'));
  const workingCount = projects.length - offIds.size;
  const plannedCount = projects.filter((p) => !offIds.has(p.id) && plansFor(p.id).length).length;
  const pendingLeaves = leaves.filter((l) => l.status === 'pending').length;
  const pendingPlans = workingPlans.filter((p) => p.status !== 'approved').length;
  const done = () => { setEditing(null); load(); };

  return (
    <>
      <div className="between no-print-wrap">
        <div>
          <h1>Day planner</h1>
          <div className="small muted">{isAdmin ? 'Plans from all staff for every site. Change a plan here when things change on the day; the staff member is told.' : 'Fill in tomorrow’s plan for your sites every evening. All staff can see the full planner; only the admin can change other people’s plans.'}</div>
        </div>
        {(
          <div className="row no-print" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {locked
              ? <button className="btn small ghost" disabled title="Unlocks after the admin approves this day">PDF locked · waiting for approval</button>
              : <button className="btn small" disabled={pdfBusy} onClick={makePdf}>{pdfBusy ? 'Making PDF…' : `PDF · ${pdfHeading(date)}`}</button>}
            {!standalone && !locked && <button className="btn small ghost" onClick={() => window.print()}>Print</button>}
          </div>
        )}
      </div>
      <div className={locked ? 'print-locked' : ''}>
      <div className="print-only" style={{ marginBottom: 8 }}><b>{pdfHeading(date)} · {longDate(date)}</b></div>
      <ErrorBox error={error} />
      <PhoneAlertsCard compact />

      <DateBar date={date} setDate={(d) => { setEditing(null); setDate(d); }} today={today} />
      {<WeekStrip today={today} date={date} week={week} siteCount={projects.length} setDate={(d) => { setEditing(null); setDate(d); }} />}
      <DayApproval date={date} past={past} isAdmin={isAdmin} approval={approval} names={names} say={say} onChanged={load}
        missing={missing.length} pendingPlans={pendingPlans} pendingLeaves={pendingLeaves} lock={lock} isSuper={isSuper} />

      {(
        <div className="plan-stats">
          <Stat label={offIds.size ? `Sites planned (${offIds.size} off)` : 'Sites planned'} value={`${plannedCount} / ${workingCount}`} warn={missing.length > 0} />
          <Stat label="Workers planned" value={summary.workers} />
          <Stat label="Teams" value={summary.teams.length} />
          <Stat label="Clashes" value={summary.clashes.length} warn={summary.clashes.length > 0} />
        </div>
      )}

      {missing.length > 0 && (
        <div className="card pay-warn" style={{ alignItems: 'flex-start' }}>
          <Icon name="alert" />
          <div><b>No plan yet for {missing.length === 1 ? '1 site' : `${missing.length} sites`}</b>
            <div className="small">{missing.map((p) => p.name).join(' · ')}</div></div>
        </div>
      )}

      {changes.length > 0 && (
        <div className="card">
          <div className="card-title">Changes during the day ({changes.length})</div>
          {changes.map((c) => (
            <div key={c.id} className={`small${c.status === 'rejected' ? ' muted' : ''}`} style={c.status === 'rejected' ? { textDecoration: 'line-through' } : undefined}>
              <b>{siteName(c.project_id)}:</b> {changeText(c, siteName, c.project_id)}
              {c.kind === 'hindrance' && c.status === 'pending' && <span className="pill due" style={{ marginLeft: 6 }}>Waiting for approval</span>}
            </div>
          ))}
        </div>
      )}

      {summary.clashes.length > 0 && (
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
          const here = isAdmin || (isPm && p.pm_id === user?.id);
          const list = plansFor(p.id);
          const mine = list.find((x) => x.created_by === user?.id);
          const isEditing = editing && editing.project.id === p.id;
          const leave = leaveFor(p.id);
          const off = offIds.has(p.id);
          return (
            <section key={p.id} className={`card plan-site${off ? ' site-off' : ''}`}>
              <div className="between">
                <div><div className="card-title">{p.name}</div><div className="small muted">{p.location || ''}{p.pm_id ? ` · PM: ${names[p.pm_id] || '—'}` : ''}</div></div>
                {off ? <span className="pill">Site off</span> : !list.length && !leave && <span className="pill upcoming">{past ? 'No plan' : 'Not planned'}</span>}
              </div>
              <SiteLeave project={p} date={date} past={past} approved={!!approval} leave={leave} isAdmin={here} userId={user?.id}
                author={leave ? names[leave.created_by] : null} say={say} onChanged={load} />
              {!off && (
                <SiteChanges project={p} date={date} today={today} changes={changes} projects={projects} siteName={siteName}
                  names={names} isAdmin={here} userId={user?.id} plans={plans} say={say} onChanged={load} />
              )}

              {list.map((plan) => (isEditing && editing.plan?.id === plan.id ? null : (
                <PlanView key={plan.id} plan={plan} isAdmin={here} isSuper={isSuper} author={names[plan.created_by]}
                  canEdit={here || (!past && plan.created_by === user?.id)}
                  onEdit={() => setEditing({ project: p, plan })} onChanged={() => { load(); }} say={say} />
              )))}

              {isEditing ? (
                <PlanForm project={p} date={date} plan={editing.plan} isAdmin={here} say={say} approved={!!approval}
                  author={editing.plan && editing.plan.created_by !== user?.id ? names[editing.plan.created_by] || 'the staff member' : null}
                  onDone={done} onCancel={() => setEditing(null)} />
              ) : (!past || here) && (!mine || here) && (here || !list.length || !mine) && (
                <button className="btn small outline no-print" onClick={() => setEditing({ project: p, plan: here ? null : mine || null })}>
                  <Icon name="plus" size={18} /> {list.length ? 'Add another plan' : `Plan ${dayName(date).toLowerCase() === 'tomorrow' ? 'tomorrow' : 'this day'}`}
                </button>
              )}
            </section>
          );
        })}
        {!projects.length && <div className="card">No active projects.</div>}
      </div>

      {workingPlans.length > 0 && <Rollups summary={summary} plans={workingPlans} siteName={siteName} />}
      </div>
      {toast}
    </>
  );
}

const fmtTime = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const LEAVE_REASONS = ['Heavy rain', 'Material not arrived', 'Client asked to stop', 'Labour not available', 'Holiday / function', 'Power / water not available'];

function DayApproval({ date, past, isAdmin, approval, names, say, onChanged, missing, pendingPlans, pendingLeaves, lock, isSuper }) {
  const t0 = todayStr();
  const when = date === t0 ? 'today' : date === addDays(t0, 1) ? 'tomorrow' : null;
  const label = when ? `${when === 'today' ? 'Today' : 'Tomorrow'}’s plan` : 'Day plan';
  const day = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function approve() {
    setBusy(true); setError(null);
    try { await must(supabase.from('day_approvals').insert({ plan_date: date })); say(`${label} approved (${day}) — staff can now make the “${pdfHeading(date)}” PDF`); onChanged(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function undo() {
    if (!window.confirm('Remove the approval? Staff won\u2019t be able to make the PDF until you approve again.')) return;
    setBusy(true); setError(null);
    try { await must(supabase.from('day_approvals').delete().eq('plan_date', date)); say('Approval removed'); onChanged(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  if (approval) {
    return (
      <div className="card day-approval ok no-print">
        <Icon name="check" />
        <div style={{ flex: 1 }} className="small"><b>{label} approved · {day}</b> · by {names[approval.approved_by] || 'admin'}, {fmtTime(approval.approved_at)}
          {!isAdmin && when === 'tomorrow' && <div>Make the “Tomorrow planned sites” PDF now. Tomorrow morning, if nothing changes, just make the “Today running sites” PDF — no new approval needed. If you change anything, the super admin must approve again.</div>}
          {!isAdmin && when === 'today' && <div>You can make the “Today running sites” PDF. If you change anything now, the super admin must approve again.</div>}
          {isAdmin && when === 'tomorrow' && <div>Tomorrow morning staff print it as “Today running sites”. If they change anything, the super admin must approve again.</div>}<ErrorBox error={error} /></div>
        {isAdmin && <button className="btn small ghost" disabled={busy} onClick={undo}>Undo</button>}
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="card day-approval warn no-print">
        <Icon name="alert" />
        <div className="small"><b>{label} · {day} · waiting for approval</b><div>The “{pdfHeading(date)}” PDF unlocks by itself once every site is approved by its PM (or the admin).{lock ? ' This day was changed after approval, so the super admin must approve it again.' : ''}</div></div>
      </div>
    );
  }
  const issues = [missing && `${missing} site${missing === 1 ? '' : 's'} without a plan or site off`, pendingPlans && `${pendingPlans} site plan${pendingPlans === 1 ? '' : 's'} not approved`,
    pendingLeaves && `${pendingLeaves} site-off request${pendingLeaves === 1 ? '' : 's'} waiting`].filter(Boolean);
  return (
    <div className="card day-approval warn no-print">
      <Icon name="alert" />
      <div style={{ flex: 1 }} className="small"><b>Approve {when ? `${when}’s plan` : 'this day’s plan'} · {day}</b>
        {lock && <div className="plan-changed" style={{ margin: '4px 0' }}>Changed after approval: {lock.site}. {isSuper ? 'Approve the changed plan(s), then the day.' : 'Only the super admin can approve this day again.'}</div>}
        <div>{issues.length ? `Approve every site first. Still open: ${issues.join(', ')}.` : 'Every site is approved. Staff can make the PDF once you approve the day.'}</div>
        <ErrorBox error={error} /></div>
      {!past && (!lock || isSuper) && <button className="btn small" disabled={busy || issues.length > 0} onClick={approve}>{busy ? 'Approving…' : `Approve ${when ? `${when}’s plan` : 'day plan'} (${day})`}</button>}
      {past && <button className="btn small ghost" disabled={busy} onClick={approve}>Approve</button>}
    </div>
  );
}

function SiteLeave({ project, date, past, leave, isAdmin, userId, author, say, onChanged, approved }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(leave?.client_message || '');
  useEffect(() => { setMsg(leave?.client_message || ''); }, [leave?.id, leave?.client_message]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, msg) => {
    setBusy(true); setError(null);
    try { await fn(); if (msg) say(msg); setOpen(false); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    if (!reason.trim()) return setError(new Error('Write the reason the site is off.'));
    if (!isAdmin && approved && !window.confirm(`${longDate(date)} is already approved. If you send this, the super admin must approve the day again before you can make the PDF. Send it?`)) return;
    run(() => (leave
      ? must(supabase.from('site_leaves').update({ reason: reason.trim(), client_message: msg.trim() }).eq('id', leave.id))
      : must(supabase.from('site_leaves').insert({ project_id: project.id, leave_date: date, reason: reason.trim(), client_message: msg.trim() }))),
    isAdmin ? 'Site marked off' : 'Site-off request sent to admin');
  };
  const decide = (status) => run(() => must(supabase.from('site_leaves').update({ status, admin_note: note.trim(), ...(status === 'approved' ? { client_message: msg.trim() } : {}) }).eq('id', leave.id)),
    status === 'approved' ? 'Site off approved · client notified' : 'Site off rejected');
  const resend = () => run(() => must(supabase.from('site_leaves').update({ client_message: msg.trim() }).eq('id', leave.id)), 'Client message updated and sent');
  const clientText = (leave?.client_message || '').trim() || leave?.reason;
  const remove = () => { if (window.confirm('Remove this site-off entry?')) run(() => must(supabase.from('site_leaves').delete().eq('id', leave.id)), 'Removed'); };
  const mine = leave && leave.created_by === userId;

  if (open) {
    return (
      <form className="leave-form no-print" onSubmit={submit}>
        <b className="small">Site off on {longDate(date)} — reason</b>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {LEAVE_REASONS.map((r) => <button type="button" key={r} className={`chip${reason === r ? ' on' : ''}`} onClick={() => setReason(r)}>{r}</button>)}
        </div>
        <input className="input" placeholder="Reason (you can add details)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="input" placeholder="Message to client (optional, e.g. Concrete curing in progress)" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div className="small muted">The client is told once the site off is approved. If the message is empty, the reason is sent.</div>
        <ErrorBox error={error} />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" disabled={busy}>{busy ? 'Saving…' : isAdmin ? 'Mark site off' : 'Send to admin'}</button>
          <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    );
  }
  if (!leave) {
    return (!past || isAdmin) ? (
      <button className="btn small ghost no-print" style={{ alignSelf: 'flex-start' }} onClick={() => { setReason(''); setMsg(''); setOpen(true); }}>Mark site off (no work)</button>
    ) : null;
  }
  const label = { pending: 'Site-off requested', approved: 'Site off', rejected: 'Site-off request rejected' }[leave.status];
  return (
    <div className={`leave-box ${leave.status}`}>
      <div><b>{label}:</b> {leave.reason}</div>
      <div className="small muted">By {author || 'staff'}{leave.decided_at ? ` · ${leave.status === 'approved' ? 'approved' : 'rejected'} ${fmtTime(leave.decided_at)}` : ''}</div>
      {leave.status !== 'rejected' && <div className="small"><b>Message to client:</b> {clientText}</div>}
      {leave.admin_note && <div className="small"><b>Admin:</b> {leave.admin_note}</div>}
      {isAdmin && leave.status === 'pending' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <input className="input" style={{ height: 38, fontSize: 14 }} placeholder={`Message to client (empty = "${leave.reason}")`} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <input className="input" style={{ height: 38, fontSize: 14 }} placeholder="Note to staff (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" disabled={busy} onClick={() => decide('approved')}>Approve site off</button>
            <button className="btn small ghost" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
          </div>
        </div>
      )}
      <div className="row no-print" style={{ gap: 6, marginTop: 4 }}>
        {isAdmin && leave.status === 'approved' && !past && (
          <>
            <input className="input" style={{ height: 34, fontSize: 13, flex: 1, minWidth: 180 }} placeholder="Change message to client" value={msg} onChange={(e) => setMsg(e.target.value)} />
            {msg.trim() !== (leave.client_message || '').trim() && <button className="btn small" disabled={busy} onClick={resend}>Send to client</button>}
          </>
        )}
        {isAdmin && leave.status === 'approved' && (
          <button className="btn small ghost" disabled={busy} onClick={() => decide('rejected')}>Cancel site off</button>
        )}
        {mine && !past && leave.status !== 'approved' && (
          <button className="btn small ghost" onClick={() => { setReason(leave.reason); setMsg(leave.client_message || ''); setOpen(true); }}>{leave.status === 'rejected' ? 'Request again' : 'Edit reason'}</button>
        )}
        {(isAdmin || (mine && !past && leave.status !== 'approved')) && <button className="btn small danger" disabled={busy} onClick={remove}>Remove</button>}
      </div>
      <ErrorBox error={error} />
    </div>
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

function PlanView({ plan, isAdmin, isSuper, author, canEdit, onEdit, onChanged, say }) {
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
          <b style={{ color: 'var(--ink)' }}>{author || 'Staff'}</b> · 
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

      {plan.changed_at && (
        <div className="plan-changed">Changed by admin · {new Date(plan.changed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</div>
      )}
      {plan.needs_super && plan.status !== 'approved' && (
        <div className="plan-changed">Changed after the day was approved · {isSuper ? 'needs your approval' : 'only the super admin can approve this'}</div>
      )}
      {!isAdmin && plan.admin_note && <div className="plan-note"><b>Admin:</b> {plan.admin_note}</div>}

      {isAdmin && (
        <div className="plan-review no-print">
          <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Note to staff (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {(!plan.needs_super || isSuper) && <button className="btn small" disabled={busy} onClick={() => review('approved')}>Approve</button>}
            <button className="btn small ghost" disabled={busy} onClick={() => review('changes')}>Ask for changes</button>
            <span style={{ flex: 1 }} />
            {canEdit && <button className="btn small ghost" onClick={onEdit}>{plan.plan_date === todayStr() ? 'Change today’s plan' : 'Edit'}</button>}
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

function PlanForm({ project, date, plan, isAdmin, author, say, onDone, onCancel, approved }) {
  const [f, setF] = useState(() => ({
    supervisor: plan?.supervisor || '', start_time: plan?.start_time || '08:00',
    tasks: plan?.tasks?.length ? plan.tasks.map((t) => ({ ...blankTask(), ...t, workers: t.workers ?? '' })) : [blankTask(), blankTask()],
    materials: plan?.materials || '', equipment: plan?.equipment || '', remarks: plan?.remarks || '',
    note: plan?.admin_note || '',
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
    if (isAdmin && author) row.admin_note = f.note.trim();
    if (!isAdmin && approved && !window.confirm(`${longDate(date)} is already approved. If you save this change, the super admin must approve it and the day again before you can make the PDF. Save the change?`)) return;
    setBusy(true); setError(null);
    try {
      if (plan) await must(supabase.from('day_plans').update(row).eq('id', plan.id));
      else await must(supabase.from('day_plans').insert({ ...row, project_id: project.id, plan_date: date }));
      say(plan ? (isAdmin && author ? `Plan changed — ${author} has been told` : 'Plan updated') : isAdmin ? 'Plan saved' : 'Plan sent to admin');
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

      {isAdmin && author && (
        <label className="field"><span>What changed? (sent to {author})</span>
          <input className="input" placeholder="e.g. Rain — 2 masons moved to Santhosh site" value={f.note} onChange={set('note')} /></label>
      )}
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
