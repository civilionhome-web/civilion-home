import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { longDate } from '../../lib/format';
import { Spinner, ErrorBox, useToast } from '../../components/ui';

const appUrl = () => window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');

function inviteText(name) {
  return `Hello${name ? ' ' + name.split(' ')[0] : ''}, you've been added to the Civilion Home staff team.\n\n`
    + `1. Open ${appUrl()}\n2. Enter this email address and tap "Email me a code"\n3. Type the 6-digit code from your email\n\n`
    + 'You will land in the admin panel. Tip: use "Add to Home screen" to keep it like an app.';
}

export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [invites, setInvites] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'staff' });
  const [toast, say] = useToast();

  const load = useCallback(async () => {
    const [p, i] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('staff_invites').select('*').order('created_at', { ascending: false }),
    ]);
    if (p.error || i.error) setError(p.error || i.error);
    setRows(p.data || []);
    setInvites(i.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addStaff(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc('invite_staff', { p_email: f.email, p_name: f.name, p_role: f.role });
    setBusy(false);
    if (err) { setError(err); return; }
    say(data === 'updated' ? `${f.name || f.email} is now ${f.role === 'admin' ? 'an Admin' : 'Staff'}` : 'Added. Send them the invite.');
    setF({ name: '', email: '', role: 'staff' });
    load();
  }

  async function update(r, patch) {
    setError(null);
    const { error: e } = await supabase.from('profiles').update(patch).eq('id', r.id);
    if (e) { setError(e); return; }
    // Taking someone off the team also cancels their invite
    if (patch.role === 'client' && r.email) await supabase.from('staff_invites').delete().eq('email', r.email.toLowerCase());
    say('Saved');
    load();
  }

  async function cancelInvite(inv) {
    if (!window.confirm(`Cancel the invite for ${inv.email}?`)) return;
    const { error: e } = await supabase.from('staff_invites').delete().eq('email', inv.email);
    if (e) setError(e); else { say('Invite cancelled'); load(); }
  }

  async function copyInvite(inv) {
    try { await navigator.clipboard.writeText(inviteText(inv.full_name)); say('Invite message copied'); }
    catch { window.prompt('Copy this message:', inviteText(inv.full_name)); }
  }

  if (!rows) return <Spinner />;
  const s = q.trim().toLowerCase();
  const match = (r) => !s || [r.full_name, r.email, r.phone].some((v) => (v || '').toLowerCase().includes(s));
  const staff = rows.filter((r) => r.role !== 'client' && match(r));
  const clients = rows.filter((r) => r.role === 'client' && match(r));
  const signedUp = new Set(rows.map((r) => (r.email || '').toLowerCase()).filter(Boolean));
  const pending = invites.filter((i) => !signedUp.has(i.email));

  const table = (items, pmCol = false) => (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Name</th><th>Phone / email</th><th>Role</th>{pmCol && <th title="Project manager: approves day plans, site-offs, DPRs and weekly plans for the projects where they are the PM">PM</th>}</tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td><input className="input" style={{ height: 38, fontSize: 14 }} defaultValue={r.full_name} aria-label="Name"
                onBlur={(e) => e.target.value !== r.full_name && update(r, { full_name: e.target.value.trim() })} /></td>
              <td className="small">{r.phone ? `+${r.phone}` : ''} {r.email}</td>
              <td>
                <select className="select" style={{ height: 38, fontSize: 14, width: 120 }} value={r.role} disabled={r.id === user.id}
                  aria-label="Role" onChange={(e) => update(r, { role: e.target.value })}>
                  <option value="client">Client</option><option value="staff">Staff</option><option value="admin">Admin</option>
                </select>
              </td>
              {pmCol && (
                <td><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={r.is_pm === true} onChange={(e) => update(r, { is_pm: e.target.checked })} /> PM</label></td>
              )}
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={pmCol ? 4 : 3} className="muted">Nobody here.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h1>Team</h1>

      <form className="card" onSubmit={addStaff}>
        <div className="card-title">Add a staff member</div>
        <div className="small muted">They sign in on the normal sign-in screen with this email and a 6-digit code. No password needed. <b>Staff</b> can manage every project; <b>Admins</b> can also manage this page and delete projects.</div>
        <div className="form-grid">
          <label className="field"><span>Name</span><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rahul Nair" /></label>
          <label className="field"><span>Work email</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="rahul@example.com" /></label>
          <label className="field"><span>Role</span>
            <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="staff">Staff</option><option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <ErrorBox error={error} />
        <div><button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add to team'}</button></div>
      </form>

      {pending.length > 0 && (
        <>
          <h2 style={{ fontSize: 18 }}>Invited, not signed in yet</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th><th /></tr></thead>
              <tbody>
                {pending.map((i) => (
                  <tr key={i.email}>
                    <td>{i.full_name}</td>
                    <td className="small">{i.email}</td>
                    <td>{i.role === 'admin' ? 'Admin' : 'Staff'}</td>
                    <td className="small">{longDate(i.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <a className="btn ghost small" href={`mailto:${i.email}?subject=${encodeURIComponent('Your Civilion Home staff access')}&body=${encodeURIComponent(inviteText(i.full_name))}`}>Email invite</a>{' '}
                      <button className="btn ghost small" onClick={() => copyInvite(i)}>Copy invite</button>{' '}
                      <button className="btn danger small" onClick={() => cancelInvite(i)}>Cancel</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <input className="input" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      <h2 style={{ fontSize: 18 }}>Staff &amp; admins</h2>
      {table(staff, true)}
      <h2 style={{ fontSize: 18 }}>Signed-in clients</h2>
      <div className="small muted">To give a client access, open their project → <b>Clients</b> tab and add their email or mobile.</div>
      {table(clients)}
      {toast}
    </>
  );
}
