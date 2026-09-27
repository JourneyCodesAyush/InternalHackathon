'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, Profile, UserRole } from './supabase';

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: UserRole | null;
  formattedRole: string;
  fullName: string | null;
  displayName: string;
  email: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isBlocked: boolean;
  blockedMessage: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function formatRole(role?: string | null): string {
  if (!role) return 'User';
  if (role === 'ADMIN') return 'Admin';
  if (role === 'NORMAL_USER') return 'Normal User';
  // Capitalize snake_case or standard words
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  // Fetch user profile from Supabase profiles table
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) {
        return null;
      }

      return data as Profile;
    } catch {
      return null;
    }
  }, []);

  // Sign out helper
  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error during signOut:', err);
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
      }
      setUser(null);
      setSession(null);
      setProfile(null);
      setIsBlocked(false);
      setBlockedMessage(null);
    }
  }, []);

  // Refresh profile data on demand
  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      const p = await fetchProfile(user.id);
      if (p) {
        if (p.is_blocked) {
          setIsBlocked(true);
          setBlockedMessage('Your account has been blocked. Please contact the administrator.');
          await signOut();
          return;
        }
        setProfile(p);
      }
    }
  }, [user, fetchProfile, signOut]);

  // Initial session hydration and auth state change subscription
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentSession = sessionData?.session ?? null;

        if (!isMounted) return;

        if (currentSession?.user) {
          setSession(currentSession);
          setUser(currentSession.user);

          if (currentSession.access_token && typeof window !== 'undefined') {
            localStorage.setItem('access_token', currentSession.access_token);
          }

          const userProfile = await fetchProfile(currentSession.user.id);
          if (!isMounted) return;

          if (userProfile?.is_blocked) {
            setIsBlocked(true);
            setBlockedMessage('Your account has been blocked. Please contact the administrator.');
            await signOut();
            setIsLoading(false);
            return;
          }

          setProfile(userProfile);
        } else {
          setSession(null);
          setUser(null);
          setProfile(null);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('access_token');
          }
        }
      } catch (err) {
        console.error('Failed to initialize auth session:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    // Listen for auth state changes (login, logout, token refresh, user update)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return;

      if (newSession?.user) {
        setSession(newSession);
        setUser(newSession.user);

        if (newSession.access_token && typeof window !== 'undefined') {
          localStorage.setItem('access_token', newSession.access_token);
        }

        const userProfile = await fetchProfile(newSession.user.id);
        if (!isMounted) return;

        if (userProfile?.is_blocked) {
          setIsBlocked(true);
          setBlockedMessage('Your account has been blocked. Please contact the administrator.');
          await signOut();
          setIsLoading(false);
          return;
        }

        setProfile(userProfile);
        setIsBlocked(false);
        setBlockedMessage(null);
      } else {
        setSession(null);
        setUser(null);
        setProfile(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
        }
      }

      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, signOut]);

  const value = useMemo<AuthContextType>(() => {
    const role: UserRole | null = profile?.role ?? null;
    const formattedRole = formatRole(role);
    const fullName = profile?.full_name ?? (user?.user_metadata?.full_name as string) ?? null;
    const email = user?.email ?? profile?.email ?? null;
    const displayName = fullName || email || 'User';

    return {
      user,
      session,
      profile,
      role,
      formattedRole,
      fullName,
      displayName,
      email,
      isAuthenticated: !!user && !isBlocked,
      isLoading,
      isBlocked,
      blockedMessage,
      signOut,
      refreshProfile,
    };
  }, [user, session, profile, isBlocked, blockedMessage, isLoading, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
