import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Spinner, ErrorBox, useToast } from '../../components/ui';

export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [toast, say] = useToast();

  const load = () => supabase.from('profiles').select('*').order('created_at', { ascending: false }).then(({ data, error: e }) => {
    if (e) setError(e);
    setRows(data || []);
  });
  useEffect(() => { load(); }, []);

  async function update(id, patch) {
    setError(null);
    const { error: e } = await supabase.from('profiles').update(patch).eq('id', id);
    if (e) setError(e); else { say('Saved'); load(); }
  }

  if (!rows) return <Spinner />;
  const s = q.trim().toLowerCase();
  const list = rows.filter((r) => !s || [r.full_name, r.email, r.phone].some((v) => (v || '').toLowerCase().includes(s)));
  const staff = list.filter((r) => r.role !== 'client');
  const clients = list.filter((r) => r.role === 'client');

  const table = (items) => (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Name</th><th>Phone / email</th><th>Role</th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td><input className="input" style={{ height: 38, fontSize: 14 }} defaultValue={r.full_name} aria-label="Name"
                onBlur={(e) => e.target.value !== r.full_name && update(r.id, { full_name: e.target.value.trim() })} /></td>
              <td className="small">{r.phone ? `+${r.phone}` : ''} {r.email}</td>
              <td>
                <select className="select" style={{ height: 38, fontSize: 14, width: 120 }} value={r.role} disabled={r.id === user.id}
                  aria-label="Role" onChange={(e) => update(r.id, { role: e.target.value })}>
                  <option value="client">Client</option><option value="staff">Staff</option><option value="admin">Admin</option>
                </select>
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={3} className="muted">Nobody here.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h1>Team</h1>
      <div className="card small" style={{ lineHeight: 1.55 }}>
        <b>Adding a staff member:</b> in Supabase → Authentication → Users → Add user, enter their work email and a password
        (tick "Auto confirm"). They then appear below as a Client. Change their role to Staff. Staff can see and edit every project;
        Admins can also manage this page.
      </div>
      <input className="input" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      <ErrorBox error={error} />
      <h2 style={{ fontSize: 18 }}>Staff &amp; admins</h2>
      {table(staff)}
      <h2 style={{ fontSize: 18 }}>Signed-in clients</h2>
      {table(clients)}
      {toast}
    </>
  );
}
