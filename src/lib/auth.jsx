import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, isConfigured } from './supabase';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(isConfigured);

  const loadProfile = useCallback(async (s) => {
    if (!s) { setProfile(null); return; }
    // The profile row is made by a database trigger; retry briefly right after first sign-in.
    for (let i = 0; i < 4; i++) {
      const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
      if (data) { setProfile(data); return; }
      await new Promise((r) => setTimeout(r, 600));
    }
    setProfile({ id: s.user.id, role: 'client', full_name: '' });
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => loadProfile(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value = {
    session,
    user: session?.user || null,
    profile,
    isStaff: profile?.role === 'staff' || profile?.role === 'admin',
    isAdmin: profile?.role === 'admin',
    isSuper: profile?.role === 'admin' && profile?.is_super === true,
    loading,
    refreshProfile: () => loadProfile(session),
    signOut: async () => { await supabase.auth.signOut(); localStorage.removeItem('civ_project'); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
