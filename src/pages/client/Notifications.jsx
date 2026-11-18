import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useProject } from './ClientLayout';
import { Icon, Spinner, ErrorBox } from '../../components/ui';
import { pushState, enablePush, disablePush } from '../../lib/push';

const KIND_ICON = { bill: 'payments', credit: 'payments', paid: 'payments', decision: 'alert', log: 'camera', update: 'camera', message: 'chat', document: 'docs', stage: 'progress' };

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

// Unread count for the bell, kept live
export function useUnread(projectId, userId) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!projectId || !userId) return;
    const { data: seen } = await supabase.from('notification_seen').select('seen_at').eq('user_id', userId).eq('project_id', projectId).maybeSingle();
    let q = supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('project_id', projectId);
    if (seen?.seen_at) q = q.gt('created_at', seen.seen_at);
    const { count: c } = await q;
    setCount(c || 0);
  }, [projectId, userId]);
  useEffect(() => {
    refresh();
    if (!projectId) return undefined;
    const ch = supabase.channel(`notif-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `project_id=eq.${projectId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, refresh]);
  return count;
}

export function Bell({ count }) {
  return (
    <Link to="/notifications" className="round-btn" aria-label={count ? `Notifications, ${count} new` : 'Notifications'} style={{ position: 'relative' }}>
      <Icon name="bell" size={20} />
      {count > 0 && <span className="bell-badge">{count > 9 ? '9+' : count}</span>}
    </Link>
  );
}

export default function Notifications() {
  const { project } = useProject();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const nav = useNavigate();
  const [rows, setRows] = useState(null);
  const [seenAt, setSeenAt] = useState(null);
  const [push, setPush] = useState('…');
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ data: seen }, { data }, { data: em }] = await Promise.all([
        supabase.from('notification_seen').select('seen_at').eq('user_id', userId).eq('project_id', project.id).maybeSingle(),
        supabase.from('notifications').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(80),
        supabase.rpc('my_email_notifications'),
      ]);
      if (!live) return;
      setSeenAt(seen?.seen_at || null);
      setRows(data || []);
      setEmail(em !== false);
      // mark everything as seen
      if (userId) await supabase.from('notification_seen').upsert({ user_id: userId, project_id: project.id, seen_at: new Date().toISOString() }, { onConflict: 'user_id,project_id' });
    })();
    pushState().then((s) => live && setPush(s));
    return () => { live = false; };
  }, [project.id, userId]);

  async function togglePush() {
    setBusy(true); setError(null);
    try { if (push === 'on') await disablePush(); else await enablePush(); } catch (e) { setError(e); }
    setPush(await pushState()); setBusy(false);
  }

  async function toggleEmail() {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('set_my_email_notifications', { p_on: !email });
    if (e) setError(e); else setEmail(!email);
    setBusy(false);
  }

  const pushText = {
    on: 'On — you’ll get alerts on this phone even when the app is closed.',
    off: 'Off on this phone.',
    blocked: 'Blocked. Allow notifications for this app in your phone or browser settings.',
    'ios-install': 'On iPhone: tap Share → “Add to Home Screen”, open Civilion Home from the home screen, then come back here.',
    unsupported: 'This browser can’t show phone notifications. Try Chrome on Android, or Safari after adding to the Home Screen on iPhone.',
    '…': 'Checking…',
  }[push];

  return (
    <div className="screen no-tabs">
      <div className="back-head">
        <button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}><Icon name="back" stroke={2.2} /></button>
        <h1>Notifications</h1>
      </div>
      <div className="content">
        <div className="card" style={{ gap: 10 }}>
          <div className="between" style={{ gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Phone notifications</div>
              <div className="small muted">{pushText}</div>
            </div>
            {(push === 'on' || push === 'off') && (
              <button className={`switch${push === 'on' ? ' on' : ''}`} role="switch" aria-checked={push === 'on'} aria-label="Phone notifications" disabled={busy} onClick={togglePush}><span /></button>
            )}
          </div>
          <div className="between" style={{ gap: 12, borderTop: '1px solid var(--line, #e7e2dc)', paddingTop: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Email notifications</div>
              <div className="small muted">{email ? 'On — bills, decisions, updates, documents and messages are emailed to you.' : 'Off — nothing is emailed to you.'}</div>
            </div>
            <button className={`switch${email ? ' on' : ''}`} role="switch" aria-checked={email} aria-label="Email notifications" disabled={busy} onClick={toggleEmail}><span /></button>
          </div>
          <ErrorBox error={error} />
        </div>

        {!rows && <Spinner full={false} />}
        {rows && rows.length === 0 && <div className="card empty">No notifications yet. You’ll see new bills, decisions, site logs and messages here.</div>}
        {rows && rows.length > 0 && (
          <div className="card flush">
            {rows.map((n) => {
              const unread = !seenAt || n.created_at > seenAt;
              return (
                <Link key={n.id} to={n.link || '/'} className={`notif-row${unread ? ' unread' : ''}`}>
                  <span className="notif-icon"><Icon name={KIND_ICON[n.kind] || 'bell'} size={18} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: unread ? 700 : 600, fontSize: 14.5 }}>{n.title}</span>
                    {n.body && <span className="small muted notif-body">{n.body}</span>}
                    <span className="small muted" style={{ display: 'block', marginTop: 2 }}>{ago(n.created_at)}</span>
                  </span>
                  {unread && <span className="notif-dot" aria-label="New" />}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
