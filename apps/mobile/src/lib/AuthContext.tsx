import * as Linking from "expo-linking";
import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import type { Profile } from "./types";

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    const current = session?.user;
    if (!current) { setProfile(null); return; }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", current.id).maybeSingle();
    if (error) throw error;
    setProfile(data as Profile | null);
  }, [session?.user?.id]);

  useEffect(() => {
    let active = true;
    if (!session?.user) { setProfile(null); return; }
    void supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(({ data }) => {
      if (active) setProfile(data as Profile | null);
    });
    return () => { active = false; };
  }, [session?.user?.id]);

  const signInWithEmail = useCallback(async (email: string) => {
    const cleaned = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw new Error("Enter a valid email address.");
    const redirectTo = Linking.createURL("/auth/callback");
    const { error } = await supabase.auth.signInWithOtp({
      email: cleaned,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    session, user: session?.user || null, profile, loading, signInWithEmail, signOut, refreshProfile,
  }), [session, profile, loading, signInWithEmail, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}