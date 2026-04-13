'use client';

import { useState, useEffect, FormEvent } from 'react';
import { SITE_PASSWORD_HASH, hashPassword } from '@/lib/site-config';

const SESSION_KEY = 'namekeeper-auth';

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // No password configured — skip gate entirely
  if (!SITE_PASSWORD_HASH) {
    return <>{children}</>;
  }

  // Check sessionStorage on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === SITE_PASSWORD_HASH) {
      setAuthenticated(true);
    }
    setChecking(false);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const hash = await hashPassword(password);
    if (hash === SITE_PASSWORD_HASH) {
      sessionStorage.setItem(SESSION_KEY, hash);
      setAuthenticated(true);
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">NameKeeper</h1>
          <p className="text-sm text-slate-500">Enter the family password to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
          />
          {error && (
            <p className="text-red-500 text-xs text-center">{error}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 bg-amber-500 text-white rounded-lg font-medium text-sm hover:bg-amber-600 transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
