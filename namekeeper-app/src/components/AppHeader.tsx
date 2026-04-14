'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { useFamilyTreeStore } from '@/lib/store';
import { gedcomDataToJson, gedcomDataToGedcom, downloadFile } from '@/lib/serialization';
import { applyResearchUpdates } from '@/lib/migrations/2026-04-11-research-updates';
import { useAuth, signOut } from '@/lib/auth-store';
import SignInDialog from './SignInDialog';

export default function AppHeader() {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, isAdmin } = useAuth();
  const READ_ONLY = !isAdmin;
  const store = useFamilyTreeStore();
  const { data, filename, isDirty, loadFromGedcom, loadFromJson, clearData } = store;
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  const personCount = data?.persons.size ?? 0;
  const familyCount = data?.families.size ?? 0;

  const handleExportJson = () => {
    if (!data) return;
    const json = gedcomDataToJson(data);
    const name = filename.replace(/\.\w+$/, '') || 'family-tree';
    downloadFile(json, `${name}.json`, 'application/json');
  };

  const handleExportGedcom = () => {
    if (!data) return;
    const gedcom = gedcomDataToGedcom(data);
    const name = filename.replace(/\.\w+$/, '') || 'family-tree';
    downloadFile(gedcom, `${name}.ged`, 'text/plain');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (file.name.endsWith('.json')) {
        loadFromJson(content, file.name);
      } else {
        loadFromGedcom(content, file.name);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleRunMigration = () => {
    if (!data) return;
    if (!confirm('Apply research updates from April 11, 2026? This will add/modify people. You can undo with Ctrl+Z.')) return;
    const result = applyResearchUpdates(data, store);
    const msg = `Added ${result.added} people, updated ${result.updated} records.${result.errors.length ? ` Errors: ${result.errors.join(', ')}` : ''}`;
    setMigrationResult(msg);
    setTimeout(() => setMigrationResult(null), 8000);
  };

  const navItems = [
    { href: '/', label: 'Name Keeper' },
    { href: '/tree-view-2', label: 'Tree View' },
    { href: '/relationship', label: 'Relationship' },
  ];

  return (
    <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-6 shrink-0">
      {/* Logo */}
      <div className="font-bold text-slate-800 text-sm whitespace-nowrap">
        NameKeeper
      </div>

      {/* Navigation tabs */}
      <nav className="flex gap-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              pathname === item.href
                ? 'bg-amber-50 text-amber-800 font-medium'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Auth chrome — replaces the old bottom-right floating button */}
      {user ? (
        <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-slate-200 h-6">
          <span
            className={`w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-amber-500' : 'bg-slate-300'}`}
            title={isAdmin ? 'Signed in as admin — edits sync to Firestore' : 'Signed in (viewer only)'}
          />
          <span className="text-[11px] text-slate-500 max-w-[160px] truncate">
            {user.email}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-red-500 transition-colors ml-0.5"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSignInOpen(true)}
          className="px-2.5 py-1 mr-2 text-xs font-medium text-slate-500 hover:text-amber-700 hover:bg-amber-50 border border-slate-200 hover:border-amber-200 rounded-md transition-colors"
          title="Admin sign in"
        >
          Sign in
        </button>
      )}

      {/* File info */}
      {data && (
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="text-slate-500">{filename}</span>
          <span>{personCount} people</span>
          <span>{familyCount} families</span>
          {isDirty && (
            <span className="text-amber-500 font-medium">Unsaved</span>
          )}
        </div>
      )}

      {/* Actions — hidden in read-only mode */}
      {data && !READ_ONLY && (
        <div className="flex items-center gap-1">
          <button
            onClick={handleExportJson}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
            title="Save as JSON"
          >
            Save JSON
          </button>
          <button
            onClick={handleExportGedcom}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
            title="Export as GEDCOM"
          >
            Export GED
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
            title="Load a file"
          >
            Load File
          </button>
          <button
            onClick={handleRunMigration}
            className="px-2 py-1 text-xs text-violet-500 hover:text-violet-700 hover:bg-violet-50 rounded transition-colors"
            title="Apply research updates (April 2026)"
          >
            Apply Research
          </button>
          <button
            onClick={clearData}
            className="px-2 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Close current file"
          >
            Close
          </button>
        </div>
      )}

      {/* Migration result toast */}
      {migrationResult && (
        <div className="fixed top-14 right-4 bg-violet-50 border border-violet-200 text-violet-800 text-xs px-3 py-2 rounded-lg shadow-md z-50">
          {migrationResult}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ged,.gedcom,.json"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Sign-in dialog (opened from the header Sign-in button) */}
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </header>
  );
}
