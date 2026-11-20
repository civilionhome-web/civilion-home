import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { StaffBell } from './StaffAlerts';

export default function AdminLayout() {
  const { isAdmin, profile, signOut } = useAuth();
  return (
    <div className="admin">
      <header className="admin-top">
        <Link to="/admin" className="brand">Civilion Home · Admin</Link>
        <NavLink to="/admin" end>Projects</NavLink>
        <NavLink to="/admin/planner">Day planner</NavLink>
        {isAdmin && <NavLink to="/admin/team">Team</NavLink>}
        <Link to="/">Client view</Link>
        <StaffBell />
        <button className="btn small" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={signOut}>
          Sign out{profile?.full_name ? ` (${profile.full_name.split(' ')[0]})` : ''}
        </button>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
