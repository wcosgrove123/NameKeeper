'use client';

import { useState } from 'react';
import { useAuth, signOut } from '@/lib/auth-store';
import SignInDialog from './SignInDialog';

/**
 * Small floating auth indicator that sits in the bottom-right of the
 * viewport. Unsigned visitors see "Sign in" — the master editor sees their
 * email and a sign-out button.
 */
export default function AuthButton() {
  const { user, isAdmin, loading } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (loading) return null;

  return (
    <>
      <div className="fixed bottom-3 right-3 z-20 flex items-center gap-1.5 pointer-events-auto">
        {user ? (
          <div className="flex items-center gap-1.5 bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-full px-3 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_-2px_rgba(15,23,42,0.08)]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-amber-500' : 'bg-slate-300'}`}
              title={isAdmin ? 'Signed in as admin' : 'Signed in (viewer)'}
            />
            <span className="text-[11px] text-slate-600 max-w-[160px] truncate">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => signOut()}
              className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-red-500 transition-colors ml-1"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:text-amber-700 hover:border-amber-200 transition-colors shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_-2px_rgba(15,23,42,0.08)]"
          >
            Admin sign in
          </button>
        )}
      </div>

      <SignInDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
