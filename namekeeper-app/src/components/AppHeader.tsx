'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SettingsMenu from './SettingsMenu';

export default function AppHeader() {
  const pathname = usePathname();

  // `shortLabel` is what we show on phones — abbreviated to fit a 320px screen
  // alongside the logo + settings button without horizontal overflow.
  const navItems = [
    { href: '/', label: 'Name Keeper', shortLabel: 'Names' },
    { href: '/tree-view-2', label: 'Tree View', shortLabel: 'Tree' },
    { href: '/relationship', label: 'Relationship', shortLabel: 'Relate' },
  ];

  return (
    <header
      className="bg-white border-b border-slate-200 flex items-center px-3 sm:px-4 gap-2 sm:gap-6 shrink-0 whitespace-nowrap pt-safe-or-0"
      style={{ minHeight: '3rem' }}
    >
      {/* Logo — shrunk on phones to make room for nav + settings */}
      <div className="font-bold text-slate-800 text-sm shrink-0 hidden sm:block">
        NameKeeper
      </div>
      <div className="font-bold text-slate-800 text-sm shrink-0 sm:hidden">
        NK
      </div>

      <nav className="flex gap-0.5 sm:gap-1 shrink-0">
        {navItems.map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors ${
                active
                  ? 'bg-amber-50 text-amber-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="sm:hidden">{item.shortLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 min-w-0" />

      <SettingsMenu />
    </header>
  );
}
