'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2, AlertCircle } from 'lucide-react';

const MapContainer = dynamic(() => import('./_components/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0d0f15]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#3b82f6]/30 border-t-[#3b82f6] animate-spin" />
        <span className="text-[#9da5b7] text-sm font-medium tracking-wide">
          Initialising map…
        </span>
      </div>
    </div>
  ),
});

export default function MapPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, isBlocked, blockedMessage } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login?redirect=/map');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0d0f15]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-xs text-zinc-400">Authenticating session...</span>
        </div>
      </div>
    );
  }

  if (isBlocked) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0d0f15] p-4">
        <div className="max-w-md p-6 rounded-xl bg-red-950/40 border border-red-500/40 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-white mb-1">Access Restricted</h2>
          <p className="text-xs text-red-200">
            {blockedMessage || 'Your account has been blocked. Please contact the administrator.'}
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <main className="w-full h-full overflow-hidden">
      <MapContainer />
    </main>
  );
}
