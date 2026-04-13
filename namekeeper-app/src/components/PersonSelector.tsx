'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { GedcomData, Person } from '@/lib/types';

interface PersonSelectorProps {
  data: GedcomData;
  excludeIds?: Set<string>;
  onSelect: (personId: string) => void;
  placeholder?: string;
  label?: string;
}

export default function PersonSelector({ data, excludeIds, onSelect, placeholder = 'Search for a person...', label }: PersonSelectorProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    const matches: Person[] = [];
    for (const person of data.persons.values()) {
      if (excludeIds?.has(person.id)) continue;
      const fullName = `${person.givenName} ${person.surname}`.toLowerCase();
      if (fullName.includes(lowerQuery)) {
        matches.push(person);
        if (matches.length >= 10) break;
      }
    }
    return matches;
  }, [query, data, excludeIds]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {label && <span className="text-xs font-medium text-slate-500 block mb-1">{label}</span>}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setIsOpen(true); }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg max-h-48 overflow-y-auto">
          {results.map(person => (
            <button
              key={person.id}
              onClick={() => {
                onSelect(person.id);
                setQuery('');
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left hover:bg-amber-50 flex items-center gap-2 text-sm transition-colors"
            >
              <span className={`w-5 h-5 rounded-sm flex items-center justify-center text-[10px] font-bold ${
                person.sex === 'M' ? 'bg-blue-100 text-blue-600' : person.sex === 'F' ? 'bg-pink-100 text-pink-600' : 'bg-slate-100 text-slate-500'
              }`}>
                {person.sex === 'M' ? 'M' : person.sex === 'F' ? 'F' : '?'}
              </span>
              <span className="text-slate-700">{person.givenName} {person.surname}</span>
              {person.birthDate && (
                <span className="text-slate-400 text-xs ml-auto">{person.birthDate.match(/\d{4}/)?.[0]}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
