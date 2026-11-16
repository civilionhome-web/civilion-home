import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import ClientLayout from './pages/client/ClientLayout';
import Home from './pages/client/Home';
import LiveSite from './pages/client/LiveSite';
import Progress from './pages/client/Progress';
import Payments from './pages/client/Payments';
import Approvals from './pages/client/Approvals';
import Chat from './pages/client/Chat';
import Documents from './pages/client/Documents';
import SiteLog from './pages/client/SiteLog';
import AdminLayout from './pages/admin/AdminLayout';
import ProjectsList from './pages/admin/ProjectsList';
import ProjectAdmin from './pages/admin/ProjectAdmin';
import Team from './pages/admin/Team';

function RequireAuth({ children, staff = false }) {
  const { session, loading, isStaff, profile } = useAuth();
  const loc = useLocation();
  if (loading || (session && !profile)) return <Spinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (staff && !isStaff) return <Navigate to="/" replace />;
  return children;
}

function NotConfigured() {
  return (
    <div style={{ maxWidth: 560, margin: '60px auto', padding: 20, lineHeight: 1.6 }}>
      <h1 style={{ fontFamily: 'var(--display)' }}>Almost there</h1>
      <p>The app isn't connected to its database yet. Copy <code>.env.example</code> to <code>.env</code>, paste your Supabase URL and anon key, then restart. See <b>README.md</b>, step 2.</p>
    </div>
  );
}

function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<RequireAuth staff><AdminLayout /></RequireAuth>}>
            <Route index element={<ProjectsList />} />
            <Route path="project/:id" element={<ProjectAdmin />} />
            <Route path="team" element={<Team />} />
          </Route>
          <Route element={<RequireAuth><ClientLayout /></RequireAuth>}>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<LiveSite />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/site-log" element={<SiteLog />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
