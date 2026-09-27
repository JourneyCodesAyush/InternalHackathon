'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Compass, Eye, EyeOff, AlertCircle, Loader2, CheckCircle2, ShieldCheck, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';
  const targetDestination = redirectPath.startsWith('/') ? redirectPath : '/';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccessVerification, setIsSuccessVerification] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    // Client-side validation
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!password || password.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      // Supabase email/password sign-up
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedName,
          },
        },
      });

      if (error) {
        const lowerMsg = (error.message || '').toLowerCase();
        if (
          lowerMsg.includes('already registered') ||
          lowerMsg.includes('already exists') ||
          lowerMsg.includes('user_already_exists')
        ) {
          setErrorMessage('An account with this email already exists.');
        } else if (
          lowerMsg.includes('weak') ||
          lowerMsg.includes('password should be') ||
          lowerMsg.includes('password must')
        ) {
          setErrorMessage('Your password does not meet the required requirements.');
        } else if (lowerMsg.includes('invalid') && lowerMsg.includes('email')) {
          setErrorMessage('Please enter a valid email address.');
        } else {
          setErrorMessage('Unable to create your account. Please try again.');
        }
        setIsLoading(false);
        return;
      }

      // Handle Supabase email enumeration protection: existing accounts return user with empty identities
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setErrorMessage('An account with this email already exists.');
        setIsLoading(false);
        return;
      }

      // Check if user object was returned
      if (data?.user) {
        // Ensure profile row exists in profiles table with default role and non-blocked status
        try {
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', data.user.id)
            .single();

          if (!existingProfile) {
            await supabase.from('profiles').insert({
              id: data.user.id,
              email: trimmedEmail.toLowerCase(),
              full_name: trimmedName,
              role: 'NORMAL_USER',
              is_blocked: false,
            });
          }
        } catch {
          // If trigger already inserted or RLS limits insert, proceed gracefully
        }
      }

      // Handle email verification flow if session was not returned immediately
      if (!data.session) {
        setIsSuccessVerification(true);
        setIsLoading(false);
        return;
      }

      // Direct sign-in if email confirmation is disabled
      if (data.session.access_token) {
        localStorage.setItem('access_token', data.session.access_token);
      }
      router.push(targetDestination);
    } catch {
      setErrorMessage('Unable to create your account. Please try again.');
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

      {/* Card Container */}
      <div className="bg-[#141721] border border-[#242938] rounded-xl p-6 sm:p-8 shadow-2xl shadow-black/50 backdrop-blur-sm">
        {isSuccessVerification ? (
          /* Email Verification Sent Screen */
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-semibold text-white tracking-tight mb-2">
              Account created successfully.
            </h2>
            <div className="p-4 rounded-lg bg-[#0d0f15] border border-[#242938] text-xs text-[#9da5b7] text-left space-y-2 mb-6">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <Mail className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Verify your email address</span>
              </div>
              <p>
                Please check your inbox at <span className="text-white font-mono">{email}</span> and verify your account before signing in.
              </p>
            </div>

            <Link
              href={redirectPath !== '/' ? `/login?redirect=${encodeURIComponent(redirectPath)}` : '/login'}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs tracking-wide uppercase shadow-md shadow-blue-600/20 inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              Proceed to Sign In
            </Link>
          </div>
        ) : (
          /* Registration Form */
          <>
            <div className="mb-6 text-center sm:text-left">
              <h2 className="text-lg font-semibold text-white tracking-tight">Create your account</h2>
              <p className="text-xs text-[#9da5b7] mt-1">
                Access high-resolution downscaling, wind advection, and source attribution.
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
              {/* Full Name */}
              <div>
                <label
                  htmlFor="fullName"
                  className="block text-xs font-medium text-[#9da5b7] mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  disabled={isLoading}
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Dr. Rajesh Sharma"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0d0f15] border border-[#242938] text-sm text-[#f1f3f7] placeholder-[#5e6678] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              {/* Email */}
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

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-[#9da5b7] mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="At least 8 characters"
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

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-medium text-[#9da5b7] mb-1.5"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="Re-enter password"
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-lg bg-[#0d0f15] border border-[#242938] text-sm text-[#f1f3f7] placeholder-[#5e6678] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    tabIndex={0}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#9da5b7] hover:text-[#f1f3f7] focus:outline-none focus:text-white rounded"
                  >
                    {showConfirmPassword ? (
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
                    <span>Creating account...</span>
                  </>
                ) : (
                  <span>Create Account</span>
                )}
              </button>
            </form>

            {/* Navigation to Login */}
            <div className="mt-6 pt-5 border-t border-[#242938] text-center">
              <p className="text-xs text-[#9da5b7]">
                Already have an account?{' '}
                <Link
                  href={redirectPath !== '/' ? `/login?redirect=${encodeURIComponent(redirectPath)}` : '/login'}
                  className="text-blue-400 hover:text-blue-300 font-semibold focus:outline-none focus:underline underline-offset-2 transition-colors"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </>
        )}
      </div>

      {/* Security badge footer */}
      <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-[#5e6678]">
        <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
        <span>Role assigned automatically: NORMAL_USER</span>
      </div>
    </div>
  );
}

export default function SignUpPage() {
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
        <SignUpForm />
      </Suspense>
    </div>
  );
}
