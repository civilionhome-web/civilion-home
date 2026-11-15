import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { TabBar, Spinner, Logo, ErrorBox } from '../../components/ui';
import { chatSeenAt } from '../../components/ChatView';

const ProjectCtx = createContext(null);
export const useProject = () => useContext(ProjectCtx);

const TAB_PATHS = ['/', '/progress', '/payments'];

export default function ClientLayout() {
  const { profile, user, isStaff, signOut, refreshProfile } = useAuth();
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectIdState] = useState(() => localStorage.getItem('civ_project') || '');
  const [error, setError] = useState(null);
  const [chatDot, setChatDot] = useState(false);
  const loc = useLocation();

  const load = useCallback(async () => {
    try {
      const rows = await must(supabase.from('projects').select('*').eq('archived', false).order('created_at', { ascending: false }));
      setProjects(rows);
    } catch (e) { setError(e); setProjects([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const project = projects?.find((p) => p.id === projectId) || projects?.[0] || null;
  const setProjectId = (id) => { localStorage.setItem('civ_project', id); setProjectIdState(id); };

  // Red dot on the Chat tab when the team has written since you last opened chat
  useEffect(() => {
    if (!project) return;
    let live = true;
    const check = async () => {
      const { data } = await supabase.from('messages').select('created_at').eq('project_id', project.id)
        .eq('from_staff', !isStaff).order('created_at', { ascending: false }).limit(1);
      if (live) setChatDot(Boolean(data?.[0] && data[0].created_at > chatSeenAt(project.id)));
    };
    check();
    const ch = supabase.channel(`dot-${project.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${project.id}` }, check)
      .subscribe();
    return () => { live = false; supabase.removeChannel(ch); };
  }, [project, isStaff, loc.pathname]);

  if (!projects) return <Spinner />;

  if (!project) {
    return (
      <div className="app">
        <div className="page-head" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div className="logo-box" style={{ border: '1px solid var(--line)' }}><Logo width={130} /></div>
          <h1>Your project isn't linked yet</h1>
          <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
            You're signed in as <b>{user?.phone ? `+${user.phone}` : user?.email}</b>, but no Civilion project is linked to it.
            Please ask your project manager to add this {user?.phone ? 'number' : 'email'} to your project, then reopen the app.
          </p>
          <ErrorBox error={error} />
          <div className="row">
            <button className="btn" onClick={load}>Check again</button>
            <button className="btn ghost" onClick={signOut}>Sign out</button>
          </div>
          {isStaff && <Link to="/admin">Go to the admin panel</Link>}
        </div>
      </div>
    );
  }

  const showTabs = TAB_PATHS.includes(loc.pathname);
  const needsName = !isStaff && profile && !profile.full_name;

  return (
    <ProjectCtx.Provider value={{ project, projects, setProjectId, reload: load }}>
      <div className={`app ${loc.pathname === '/live' ? 'dark' : ''}`}>
        <Outlet />
        {showTabs && <TabBar chatDot={chatDot} />}
      </div>
      {needsName && <NamePrompt onDone={refreshProfile} />}
    </ProjectCtx.Provider>
  );
}

function NamePrompt({ onDone }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user.id);
    setBusy(false);
    if (err) setError(err); else onDone();
  }
  return (
    <div className="sheet-back">
      <form className="sheet" onSubmit={save} aria-label="Your name">
        <h2 style={{ fontSize: 20 }}>Welcome to Civilion Home</h2>
        <p className="muted" style={{ margin: 0 }}>What should we call you? Your name shows on your messages and decisions.</p>
        <label className="field"><span>Your name</span>
          <input className="input" required autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <button className="btn" disabled={busy || !name.trim()}>Continue</button>
      </form>
    </div>
  );
}
