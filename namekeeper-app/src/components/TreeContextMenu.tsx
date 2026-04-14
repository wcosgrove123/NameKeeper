'use client';

import { useEffect, useRef } from 'react';
import { Person } from '@/lib/types';

interface TreeContextMenuProps {
  person: Person | null;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: (person: Person) => void;
  onDelete: (person: Person) => void;
  onAddSpouse: (person: Person) => void;
  onAddSibling: (person: Person) => void;
  onAddChild: (person: Person) => void;
  onAddParent: (person: Person) => void;
}

export default function TreeContextMenu({
  person,
  x,
  y,
  onClose,
  onEdit,
  onDelete,
  onAddSpouse,
  onAddSibling,
  onAddChild,
  onAddParent,
}: TreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  if (!person) return null;

  const items = [
    { label: 'Edit Person', icon: 'E', action: () => onEdit(person) },
    { label: 'Add Spouse', icon: '+', action: () => onAddSpouse(person) },
    { label: 'Add Sibling', icon: '+', action: () => onAddSibling(person) },
    { label: 'Add Child', icon: '+', action: () => onAddChild(person) },
    { label: 'Add Parent', icon: '+', action: () => onAddParent(person) },
    { label: 'Delete Person', icon: 'x', action: () => onDelete(person), danger: true },
  ];

  // Adjust position to stay within viewport
  const menuWidth = 180;
  const menuHeight = items.length * 36 + 16;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100">
        {person.givenName} {person.surname}
      </div>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.action(); onClose(); }}
          className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors ${
            item.danger
              ? 'text-red-500 hover:bg-red-50'
              : 'text-slate-700 hover:bg-amber-50'
          }`}
        >
          <span className={`w-5 text-center text-xs font-mono ${item.danger ? 'text-red-400' : 'text-slate-400'}`}>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
