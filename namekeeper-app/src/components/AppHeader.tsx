'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SettingsMenu from './SettingsMenu';

export default function AppHeader() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Name Keeper' },
    { href: '/tree-view-2', label: 'Tree View' },
    { href: '/relationship', label: 'Relationship' },
  ];

  return (
    <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-6 shrink-0 whitespace-nowrap">
      {/* Logo */}
      <div className="font-bold text-slate-800 text-sm shrink-0">
        NameKeeper
      </div>

      {/* Navigation tabs */}
      <nav className="flex gap-1 shrink-0">
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
      <div className="flex-1 min-w-0" />

      {/* Single gold hamburger that owns Account + File + Data */}
      <SettingsMenu />
    </header>
  );
}
