'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, signOut } from '@/lib/auth-store';
import { useFamilyTreeStore } from '@/lib/store';
import { gedcomDataToJson, gedcomDataToGedcom, downloadFile } from '@/lib/serialization';
import { applyResearchUpdates } from '@/lib/migrations/2026-04-11-research-updates';
import SignInDialog from './SignInDialog';

interface SettingsMenuProps {
  /** Visual variant of the trigger button. */
  variant?: 'solid' | 'glass';
}

/**
 * The single entry-point for account + file management, triggered by a
 * gold hamburger button in the header. Visually mirrors the Legend panel
 * (same rounded card, backdrop blur, layered shadow).
 *
 * Layout:
 *   ACCOUNT    email + sign out, or "Sign in"
 *   FILE       Save JSON · Export GEDCOM · Load file …   (admin only)
 *   DATA       Apply Research · Close file                (admin only)
 *   footer     filename + person/family counts
 */
export default function SettingsMenu({ variant = 'solid' }: SettingsMenuProps = {}) {
  const { user, isAdmin } = useAuth();
  const store = useFamilyTreeStore();
  const { data, filename, isDirty, clearData, loadFromGedcom, loadFromJson } = store;
  const hasData = !!data;
  const personCount = data?.persons.size ?? 0;
  const familyCount = data?.families.size ?? 0;

  const [open, setOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Self-sourced action handlers
  const handleExportJson = () => {
    if (!data) return;
    const json = gedcomDataToJson(data);
    const name = filename.replace(/\.\w+$/, '') || 'family-tree';
    downloadFile(json, `${name}.json`, 'application/json');
  };
  const handleExportGedcom = () => {
    if (!data) return;
    const ged = gedcomDataToGedcom(data);
    const name = filename.replace(/\.\w+$/, '') || 'family-tree';
    downloadFile(ged, `${name}.ged`, 'text/plain');
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (file.name.endsWith('.json')) loadFromJson(content, file.name);
      else loadFromGedcom(content, file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  const handleRunMigration = () => {
    if (!data) return;
    if (!confirm('Apply research updates from April 11, 2026? This will add/modify people. You can undo with Ctrl+Z.')) return;
    const result = applyResearchUpdates(data, store);
    const msg = `Added ${result.added} people, updated ${result.updated} records.${result.errors.length ? ` Errors: ${result.errors.join(', ')}` : ''}`;
    setToast(msg);
    setTimeout(() => setToast(null), 8000);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <div ref={ref} className="relative shrink-0">
        {/* Gold hamburger trigger. `glass` variant suits the TreeView2 landing
         * nav; `solid` matches the top AppHeader on Name Keeper / Tree View. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Settings"
          className={
            variant === 'glass'
              ? `flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                  open
                    ? 'bg-white/60 text-amber-700'
                    : isAdmin
                      ? 'text-amber-600 hover:bg-white/50 hover:text-amber-700'
                      : 'text-slate-500 hover:bg-white/50 hover:text-amber-700'
                }`
              : `flex items-center justify-center w-8 h-8 rounded-md transition-colors border ${
                  open
                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                    : isAdmin
                      ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100 hover:text-amber-700'
                      : 'bg-white text-slate-500 border-slate-200 hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50'
                }`
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute top-full right-0 mt-1.5 w-[min(240px,calc(100vw-1.5rem))] rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-6px_rgba(15,23,42,0.18)] overflow-hidden z-40"
          >
            {/* Account */}
            <Section label="Account">
              {user ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span
                      className={`shrink-0 w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-amber-500' : 'bg-slate-300'}`}
                      title={isAdmin ? 'Admin — edits sync to Firestore' : 'Viewer only'}
                    />
                    <span
                      className="text-[11px] text-slate-600 truncate flex-1"
                      title={user.email || undefined}
                    >
                      {user.email}
                    </span>
                  </div>
                  <MenuItem onClick={() => { signOut(); close(); }}>
                    Sign out
                  </MenuItem>
                </>
              ) : (
                <MenuItem onClick={() => { setSignInOpen(true); close(); }} accent="amber">
                  Admin sign in
                </MenuItem>
              )}
            </Section>

            {hasData && isAdmin && (
              <>
                <Divider />
                <Section label="File">
                  <MenuItem onClick={() => { handleExportJson(); close(); }}>Save JSON</MenuItem>
                  <MenuItem onClick={() => { handleExportGedcom(); close(); }}>Export GEDCOM</MenuItem>
                  <MenuItem onClick={() => { fileInputRef.current?.click(); close(); }}>Load file…</MenuItem>
                </Section>
                <Divider />
                <Section label="Data">
                  <MenuItem onClick={() => { handleRunMigration(); close(); }} accent="violet">
                    Apply Research
                  </MenuItem>
                  <MenuItem onClick={() => { clearData(); close(); }} accent="red">
                    Close file
                  </MenuItem>
                </Section>
              </>
            )}

            {hasData && (
              <>
                <Divider />
                <div className="px-3 py-2 text-[10px] text-slate-400 flex items-center gap-2">
                  <span className="truncate flex-1" title={filename}>{filename}</span>
                  <span className="shrink-0">{personCount}·{familyCount}</span>
                  {isDirty && <span className="shrink-0 text-amber-500 font-medium">•</span>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".ged,.gedcom,.json"
        onChange={handleFileSelect}
        className="hidden"
      />

      {toast && (
        <div
          className="fixed left-3 right-3 sm:left-auto sm:right-4 top-14 sm:max-w-xs bg-violet-50 border border-violet-200 text-violet-800 text-xs px-3 py-2 rounded-lg shadow-md z-50"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}
        >
          {toast}
        </div>
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
        {label}
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-100" />;
}

function MenuItem({
  onClick,
  children,
  accent,
}: {
  onClick: () => void;
  children: React.ReactNode;
  accent?: 'amber' | 'violet' | 'red';
}) {
  const accentCls =
    accent === 'amber'
      ? 'text-amber-700 hover:bg-amber-50 hover:text-amber-800'
      : accent === 'violet'
        ? 'text-violet-600 hover:bg-violet-50 hover:text-violet-700'
        : accent === 'red'
          ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
          : 'text-slate-600 hover:bg-amber-50 hover:text-amber-800';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-[12px] text-left transition-colors ${accentCls}`}
    >
      {children}
    </button>
  );
}
