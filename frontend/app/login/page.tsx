'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Compass, Eye, EyeOff, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isBlocked: authBlocked, blockedMessage } = useAuth();

  const redirectPath = searchParams.get('redirect') || '/';
  const targetDestination = redirectPath.startsWith('/') ? redirectPath : '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If already authenticated and not blocked, redirect to target destination
  useEffect(() => {
    if (isAuthenticated && !authBlocked) {
      router.push(targetDestination);
    }
  }, [isAuthenticated, authBlocked, router, targetDestination]);

  const displayError =
    errorMessage ||
    (authBlocked
      ? blockedMessage || 'Your account has been blocked. Please contact the administrator.'
      : null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    // Client-side validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        const lowerMsg = (error.message || '').toLowerCase();
        if (
          lowerMsg.includes('invalid login credentials') ||
          lowerMsg.includes('invalid credentials') ||
          lowerMsg.includes('invalid email or password')
        ) {
          setErrorMessage('Invalid email or password.');
        } else if (lowerMsg.includes('email not confirmed')) {
          setErrorMessage('Please check your email and verify your account before signing in.');
        } else {
          setErrorMessage('Unable to sign in. Please try again.');
        }
        setIsLoading(false);
        return;
      }

      if (!data.user || !data.session) {
        setErrorMessage('Unable to sign in. Please try again.');
        setIsLoading(false);
        return;
      }

      // Check if user is blocked in profiles table
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('is_blocked')
        .eq('id', data.user.id)
        .single();

      if (!profileErr && profile?.is_blocked) {
        setErrorMessage('Your account has been blocked. Please contact the administrator.');
        await supabase.auth.signOut();
        localStorage.removeItem('access_token');
        setIsLoading(false);
        return;
      }

      // Store access token for existing application components
      if (data.session.access_token) {
        localStorage.setItem('access_token', data.session.access_token);
      }

      // Redirect to intended destination
      router.push(targetDestination);
    } catch {
      setErrorMessage('Unable to sign in. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md relative z-10 my-auto">
      {/* Branding & Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-400 mb-3 shadow-lg shadow-blue-900/20">
          <Compass className="w-6 h-6 animate-pulse" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
          AirQ Insight
          <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 bg-blue-500/15 text-blue-400 border border-blue-500/30 rounded font-semibold">
            GEO-INTEL
          </span>
        </h1>
        <p className="text-xs text-[#9da5b7] mt-1.5 font-medium tracking-wide">
          Satellite-Based Air Quality Intelligence Platform
        </p>
      </div>

      {/* Login Card */}
      <div className="bg-[#141721] border border-[#242938] rounded-xl p-6 sm:p-8 shadow-2xl shadow-black/50 backdrop-blur-sm">
        <div className="mb-6 text-center sm:text-left">
          <h2 className="text-lg font-semibold text-white tracking-tight">Welcome Back</h2>
          <p className="text-xs text-[#9da5b7] mt-1">
            Sign in with your verified credentials to access geospatial analytics.
          </p>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-5 p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-start gap-2.5 leading-relaxed"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Email field */}
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-[#9da5b7] mb-1.5"
            >
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isLoading}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="name@organization.gov"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0d0f15] border border-[#242938] text-sm text-[#f1f3f7] placeholder-[#5e6678] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Password field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-[#9da5b7]"
              >
                Password
              </label>
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={isLoading}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="••••••••"
                className="w-full pl-3.5 pr-10 py-2.5 rounded-lg bg-[#0d0f15] border border-[#242938] text-sm text-[#f1f3f7] placeholder-[#5e6678] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={0}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#9da5b7] hover:text-[#f1f3f7] focus:outline-none focus:text-white rounded"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs tracking-wide uppercase shadow-md shadow-blue-600/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>

        {/* Navigation to Signup */}
        <div className="mt-6 pt-5 border-t border-[#242938] text-center">
          <p className="text-xs text-[#9da5b7]">
            Don&apos;t have an account?{' '}
            <Link
              href={redirectPath !== '/' ? `/signup?redirect=${encodeURIComponent(redirectPath)}` : '/signup'}
              className="text-blue-400 hover:text-blue-300 font-semibold focus:outline-none focus:underline underline-offset-2 transition-colors"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>

      {/* Security badge footer */}
      <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-[#5e6678]">
        <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
        <span>Secured via Supabase Auth & JWT Sessions</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="h-full w-full bg-[#0d0f15] text-[#f1f3f7] flex flex-col items-center justify-center px-4 py-8 overflow-y-auto relative selection:bg-blue-600/30 selection:text-white">
      {/* Background subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#242938_1px,transparent_1px)] [background-size:24px_24px]"
        aria-hidden="true"
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
