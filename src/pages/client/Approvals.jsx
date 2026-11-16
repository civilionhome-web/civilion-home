import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useProject } from './ClientLayout';
import { inr, delta, shortDate, longDate } from '../../lib/format';
import { Icon, Photo, Spinner, ErrorBox } from '../../components/ui';

export default function Approvals() {
  const { project } = useProject();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const [a, o, b] = await Promise.all([
      supabase.from('approvals').select('*').eq('project_id', project.id).neq('status', 'cancelled').order('created_at', { ascending: false }),
      supabase.from('approval_options').select('*').eq('project_id', project.id).order('position'),
      supabase.from('bills').select('*').eq('project_id', project.id).eq('status', 'due').order('number'),
    ]);
    setData({ approvals: a.data || [], options: o.data || [], bills: b.data || [] });
  }, [project.id]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`appr-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approvals', filter: `project_id=eq.${project.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, project.id]);

  if (!data) return <Spinner />;
  const open = data.approvals.filter((a) => a.status === 'open');
  const done = data.approvals.filter((a) => a.status === 'decided');
  const optionsOf = (id) => data.options.filter((o) => o.approval_id === id);

  return (
    <div className="screen no-tabs">
      <div className="back-head">
        <Link to="/" className="icon-btn" aria-label="Back to home"><Icon name="back" stroke={2.2} /></Link>
        <h1>Your decisions</h1>
      </div>
      <div className="content">
        {open.length === 0 && data.bills.length === 0 && <div className="card empty">Nothing waiting for you right now.</div>}

        {open.map((a) => <OpenDecision key={a.id} a={a} options={optionsOf(a.id)} onDone={load} />)}

        {data.bills.map((b) => (
          <div key={b.id} className="card" style={{ gap: 6 }}>
            <div className="between"><span style={{ fontWeight: 600 }}>Bill {String(b.number).padStart(2, '0')} · {b.title}</span>{b.due_date && <span className="small amber" style={{ fontWeight: 600 }}>Due {shortDate(b.due_date)}</span>}</div>
            <div className="muted" style={{ fontSize: 13 }}>{inr(b.amount)} · open the bill to check measurements, then pay.</div>
            <Link to="/payments" style={{ fontWeight: 600, fontSize: 14, minHeight: 44, display: 'flex', alignItems: 'center' }}>Open bill</Link>
          </div>
        ))}

        {done.length > 0 && (
          <>
            <div className="section-label">Earlier</div>
            <div className="card flush">
              {done.map((a) => {
                const o = data.options.find((x) => x.id === a.chosen_option_id);
                const v = Number(o?.cost_delta || 0);
                return (
                  <div key={a.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14 }}>{a.reference ? `${a.reference} · ` : ''}{a.title}</div>
                      <div className="small muted">{o ? o.name : ''}{a.decided_at ? ` · ${longDate(a.decided_at)}` : ''}</div>
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 14, color: v < 0 ? 'var(--green)' : 'var(--ink)' }}>{v === 0 ? 'No change' : delta(v)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OpenDecision({ a, options, onDone }) {
  const { profile } = useAuth();
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosen = options.find((o) => o.id === picked);

  async function confirm() {
    if (!chosen) return;
    if (!window.confirm(`Confirm "${chosen.name}"? ${Number(chosen.cost_delta) > 0 ? delta(chosen.cost_delta) + ' will be added to your contract as a variation, and a bill for it will be due today.' : Number(chosen.cost_delta) < 0 ? delta(chosen.cost_delta) + ' will be reduced from your contract.' : ''}`)) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('decide_approval', { p_approval: a.id, p_option: chosen.id });
    setBusy(false);
    if (e) setError(e); else onDone();
  }

  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="between">
        <span className="card-title">{a.title}</span>
        {a.due_date && <span className="pill due">By {shortDate(a.due_date)}</span>}
      </div>
      {a.description && <div className="muted" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{a.description}</div>}
      <div role="radiogroup" aria-label={a.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((o) => {
          const v = Number(o.cost_delta);
          return (
            <button key={o.id} type="button" role="radio" aria-checked={picked === o.id} className={`option ${picked === o.id ? 'on' : ''}`} onClick={() => setPicked(o.id)}>
              <span className="sw">{o.photo_path && <Photo path={o.photo_path} alt="" />}</span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14.5 }}>{o.name}</span>
                {o.detail && <span className="small muted">{o.detail}</span>}
                <span style={{ fontSize: 13, fontWeight: 600, color: v > 0 ? 'var(--amber)' : 'var(--green)' }}>{delta(v)}</span>
              </span>
              <span className="radio" />
            </button>
          );
        })}
      </div>
      <ErrorBox error={error} />
      <button className="btn" disabled={!chosen || busy} onClick={confirm}>
        {busy ? 'Saving…' : chosen ? `Confirm ${chosen.name.split(/[ ,]/)[0]}` : 'Pick one option'}
      </button>
      <div className="small muted">Your choice is recorded with your name{profile?.full_name ? ` (${profile.full_name})` : ''} and the time.</div>
    </div>
  );
}
