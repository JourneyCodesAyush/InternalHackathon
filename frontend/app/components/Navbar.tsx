'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Compass,
  Map as MapIcon,
  UploadCloud,
  ChevronDown,
  LogOut,
  Shield,
  Menu,
  X,
  Activity,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, displayName, email, formattedRole, role, isAuthenticated, isLoading, signOut } =
    useAuth();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsDropdownOpen(false);
    await signOut();
    router.push('/');
  };

  // Generate user avatar initials from name or email
  const initials = React.useMemo(() => {
    if (!displayName) return 'U';
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  }, [displayName]);

  return (
    <header className="h-14 w-full bg-[#11141d] border-b border-[#242938] shrink-0 z-40 select-none px-3 sm:px-5 flex items-center justify-between">
      {/* Left: Branding & Main Navigation */}
      <div className="flex items-center gap-6">
        {/* Brand Link */}
        <Link
          href="/"
          className="flex items-center gap-2.5 group focus:outline-none focus:ring-1 focus:ring-blue-500/50 rounded"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 group-hover:border-blue-400/80 transition-colors">
            <Compass className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 leading-tight">
              <span className="font-bold text-sm tracking-wide text-white group-hover:text-blue-200 transition-colors">
                AirQ Insight
              </span>
              <span className="text-[10px] uppercase font-mono px-1 py-0.2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded font-semibold">
                GEO-INTEL
              </span>
            </div>
            <span className="text-[10px] text-[#9da5b7] hidden sm:inline leading-tight">
              Satellite Air Quality Intelligence
            </span>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1">
          <Link
            href="/"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === '/'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Geospatial Map
          </Link>

          <Link
            href="/upload"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === '/upload'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Model Upload & Clean
          </Link>

          <Link
            href="/visualization"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === '/visualization'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Plume Flow (Physics)
          </Link>
        </nav>
      </div>

      {/* Right: Auth Controls (Login/Signup OR User Account Menu) */}
      <div className="flex items-center gap-3">
        {isLoading ? (
          /* Neutral Skeleton Loader while checking initial session */
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[#141721] border border-[#242938] animate-pulse">
            <div className="w-5 h-5 rounded-full bg-zinc-800" />
            <div className="w-16 h-3 rounded bg-zinc-800 hidden sm:block" />
          </div>
        ) : !isAuthenticated || !user ? (
          /* Guest / Visitor State: Login and Sign Up buttons */
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg border border-[#242938] hover:border-zinc-500 bg-[#161a26] hover:bg-[#1c2233] text-xs font-medium text-zinc-200 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm shadow-blue-600/30 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              Sign Up
            </Link>
          </div>
        ) : (
          /* Authenticated User State: User Info & Account Menu */
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#141721] border border-[#242938] hover:border-[#3b4257] hover:bg-[#1b202e] text-left transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {/* Avatar Pill */}
              <div className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-500/40 text-blue-300 font-semibold text-[11px] flex items-center justify-center shrink-0">
                {initials}
              </div>

              {/* Name & Role */}
              <div className="hidden sm:flex flex-col leading-none">
                <span className="text-xs font-medium text-zinc-200 max-w-[140px] truncate">
                  {displayName}
                </span>
                <span className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-1">
                  {role === 'ADMIN' ? (
                    <span className="text-purple-400 font-semibold flex items-center gap-0.5">
                      <Shield className="w-2.5 h-2.5" />
                      Admin
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-medium">Normal User</span>
                  )}
                </span>
              </div>

              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                  isDropdownOpen ? 'rotate-180 text-zinc-200' : ''
                }`}
              />
            </button>

            {/* Account Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-[#141721] border border-[#2e3547] rounded-xl shadow-2xl overflow-hidden z-50 py-1 backdrop-blur-md">
                {/* User Details Header */}
                <div className="px-4 py-3 border-b border-[#242938] bg-[#0f121a]">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">
                      {initials}
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-semibold text-white truncate">
                        {displayName}
                      </div>
                      <div className="text-[11px] text-[#9da5b7] font-mono truncate">
                        {email}
                      </div>
                    </div>
                  </div>

                  {/* Role indicator */}
                  <div className="mt-2 pt-2 border-t border-[#1e2333] flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Assigned Role:</span>
                    <span
                      className={`font-semibold px-2 py-0.5 rounded text-[10px] uppercase font-mono ${
                        role === 'ADMIN'
                          ? 'bg-purple-950/60 text-purple-300 border border-purple-500/40'
                          : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {formattedRole}
                    </span>
                  </div>
                </div>

                {/* Quick Navigation Links */}
                <div className="py-1 border-b border-[#242938]">
                  <Link
                    href="/"
                    onClick={() => setIsDropdownOpen(false)}
                    className="w-full px-4 py-2 text-xs text-zinc-300 hover:text-white hover:bg-[#1c2233] flex items-center gap-2.5 transition-colors"
                  >
                    <MapIcon className="w-3.5 h-3.5 text-blue-400" />
                    <span>Geospatial Map</span>
                  </Link>
                  <Link
                    href="/upload"
                    onClick={() => setIsDropdownOpen(false)}
                    className="w-full px-4 py-2 text-xs text-zinc-300 hover:text-white hover:bg-[#1c2233] flex items-center gap-2.5 transition-colors"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
                    <span>Model Upload & Clean</span>
                  </Link>
                </div>

                {/* Logout Action */}
                <div className="p-1">
                  <button
                    onClick={handleLogout}
                    className="w-full px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-1.5 rounded-lg border border-[#242938] bg-[#141721] text-zinc-400 hover:text-zinc-200"
          aria-label="Toggle navigation menu"
        >
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Drawer Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-14 left-0 w-full bg-[#11141d] border-b border-[#242938] shadow-2xl p-4 space-y-3 z-50">
          <nav className="flex flex-col space-y-1">
            <Link
              href="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium ${
                pathname === '/'
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'text-zinc-300 hover:bg-[#1b202e]'
              }`}
            >
              <MapIcon className="w-4 h-4 text-blue-400" />
              Geospatial Map
            </Link>

            <Link
              href="/upload"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium ${
                pathname === '/upload'
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'text-zinc-300 hover:bg-[#1b202e]'
              }`}
            >
              <UploadCloud className="w-4 h-4 text-blue-400" />
              Model Upload & Clean
            </Link>

            <Link
              href="/visualization"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium ${
                pathname === '/visualization'
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'text-zinc-300 hover:bg-[#1b202e]'
              }`}
            >
              <Activity className="w-4 h-4 text-blue-400" />
              Plume Flow (Physics)
            </Link>
          </nav>

          {!isLoading && !isAuthenticated && (
            <div className="pt-2 border-t border-[#242938] flex flex-col gap-2">
              <Link
                href="/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full py-2 text-center rounded-lg border border-[#242938] bg-[#161a26] text-xs font-medium text-zinc-200"
              >
                Login
              </Link>
              <Link
                href="/signup"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full py-2 text-center rounded-lg bg-blue-600 text-xs font-medium text-white shadow-sm"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
