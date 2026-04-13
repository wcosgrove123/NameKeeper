'use client';

import { useMemo } from 'react';
import { GedcomData } from '@/lib/types';
import { computeNameKeeper } from '@/lib/namekeeper';
import { getSurnames } from '@/lib/gedcom-parser';

interface FamilyOverviewProps {
  data: GedcomData;
  onSelectPerson: (personId: string) => void;
}

export default function FamilyOverview({ data, onSelectPerson }: FamilyOverviewProps) {
  const families = useMemo(() => {
    const surnames = getSurnames(data);
    return surnames.map(({ surname, count }) => {
      const results = computeNameKeeper(surname, data);
      const result = results[0];
      const maleCount = Array.from(data.persons.values()).filter(p => p.sex === 'M' && p.surname === surname).length;
      const livingMales = Array.from(data.persons.values()).filter(p => p.sex === 'M' && p.surname === surname && p.isLiving).length;

      return {
        surname,
        totalCount: count,
        maleCount,
        livingMales,
        patriarch: result?.patriarch,
        nameKeeper: result?.currentNameKeeper,
        isExtinct: !result?.currentNameKeeper,
      };
    }).filter(f => f.maleCount > 0);
  }, [data]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Family Tree</h1>
        <p className="text-slate-500">Select a family to explore their tree</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {families.map(family => (
          <button
            key={family.surname}
            onClick={() => family.patriarch && onSelectPerson(family.patriarch.id)}
            className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-amber-300 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-bold text-slate-800 text-lg group-hover:text-amber-700 transition-colors">
                {family.surname}
              </h3>
              {family.isExtinct ? (
                <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-400 rounded-full font-medium">
                  Extinct
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[10px] bg-green-50 text-green-600 rounded-full font-medium">
                  Active
                </span>
              )}
            </div>

            {family.patriarch && (
              <div className="text-xs text-slate-500 mb-2">
                Patriarch: {family.patriarch.givenName} {family.patriarch.surname}
                {family.patriarch.birthDate && ` (${family.patriarch.birthDate.match(/\d{4}/)?.[0]})`}
              </div>
            )}

            <div className="flex gap-3 text-xs text-slate-400">
              <span>{family.totalCount} people</span>
              <span>{family.livingMales}/{family.maleCount} males living</span>
            </div>

            {family.nameKeeper && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <div className="text-[10px] text-amber-600 font-medium">
                  Name Keeper: {family.nameKeeper.givenName} {family.nameKeeper.surname}
                </div>
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm text-slate-400">
          {data.persons.size} people across {families.length} surname families
        </p>
      </div>
    </div>
  );
}
