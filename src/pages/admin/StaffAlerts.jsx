import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { pushState, enablePush, disablePush } from '../../lib/push';
import { Spinner, ErrorBox, Icon } from '../../components/ui';

// Unread staff alerts for the bell in the admin header (re-checked every minute)
export function useStaffUnread() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    const check = () => supabase.from('staff_notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).is('read_at', null)
      .then(({ count: c }) => live && setCount(c || 0));
    check();
    const t = setInterval(check, 60000);
    window.addEventListener('staff-alerts-read', check);
    return () => { live = false; clearInterval(t); window.removeEventListener('staff-alerts-read', check); };
  }, [user]);
  return count;
}

export function StaffBell() {
  const n = useStaffUnread();
  return (
    <Link to="/admin/alerts" className="staff-bell" aria-label={n ? `${n} new alerts` : 'Alerts'}>
      <Icon name="bell" size={20} />
      {n > 0 && <span className="bell-badge">{n > 9 ? '9+' : n}</span>}
    </Link>
  );
}

// Card to switch phone alerts on, shown on the planner until it is on
export function PhoneAlertsCard({ compact = false }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { pushState().then(setState); }, []);
  if (!state || (compact && state === 'on')) return null;

  async function toggle() {
    setBusy(true); setError(null);
    try { if (state === 'on') await disablePush(); else await enablePush(); } catch (e) { setError(e); }
    setState(await pushState()); setBusy(false);
  }
  const text = {
    on: 'Phone alerts are on for this phone.',
    off: 'Turn on phone alerts to get the 6 pm day-plan reminder' + (compact ? '' : ', new plans and review results') + ' on this phone.',
    blocked: 'Alerts are blocked for this app. Allow notifications in the phone or browser settings.',
    'ios-install': 'On iPhone: tap Share → Add to Home Screen, open the app from there, then turn on alerts.',
    unsupported: 'This browser can’t show phone alerts. Reminders still come by email and under the bell.',
  }[state];
  return (
    <div className={`card no-print ${state === 'on' ? '' : 'warn'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Icon name="bell" />
      <div style={{ flex: 1 }} className="small">{text}<ErrorBox error={error} /></div>
      {(state === 'on' || state === 'off') && (
        <button className={`btn small ${state === 'on' ? 'ghost' : ''}`} disabled={busy} onClick={toggle}>
          {busy ? 'Please wait…' : state === 'on' ? 'Turn off' : 'Turn on'}
        </button>
      )}
    </div>
  );
}

export default function StaffAlerts() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('staff_notifications').select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(60);
    if (e) setError(e);
    setRows(data || []);
    if ((data || []).some((r) => !r.read_at)) {
      await supabase.from('staff_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
      window.dispatchEvent(new Event('staff-alerts-read'));
    }
  }, [user.id]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <Spinner />;
  return (
    <>
      <h1>Alerts</h1>
      <PhoneAlertsCard />
      <ErrorBox error={error} />
      <div className="card flush">
        {rows.map((r) => (
          <button key={r.id} className={`notif-row${r.read_at ? '' : ' unread'}`} onClick={() => nav(r.link || '/admin/planner')}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: r.read_at ? 500 : 700 }}>{r.title}</div>
              {r.body && <div className="small muted">{r.body}</div>}
              <div className="small muted">{new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</div>
            </div>
          </button>
        ))}
        {!rows.length && <div className="small muted" style={{ padding: 14 }}>No alerts yet. Day-plan reminders come at 6 pm and appear here.</div>}
      </div>
    </>
  );
}
