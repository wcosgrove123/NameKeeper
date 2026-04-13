'use client';

import { Person } from '@/lib/types';

interface RelationshipBadgeProps {
  personA: Person;
  personB: Person;
  relationship: string;
  onClose: () => void;
}

export default function RelationshipBadge({ personA, personB, relationship, onClose }: RelationshipBadgeProps) {
  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 bg-white shadow-xl rounded-xl border border-amber-200 px-5 py-3 animate-fade-slide-in">
      <button
        onClick={onClose}
        className="absolute top-1 right-2 text-slate-400 hover:text-slate-600 text-sm"
      >
        x
      </button>
      <div className="flex items-center gap-3">
        <div className="text-center">
          <div className={`w-8 h-8 rounded-sm flex items-center justify-center text-xs font-bold ${
            personA.sex === 'M' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'
          }`}>
            {personA.givenName[0]}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 max-w-[60px] truncate">
            {personA.givenName}
          </div>
        </div>

        <div className="text-center px-3">
          <div className="text-sm font-bold text-amber-700">{relationship}</div>
          <div className="text-[10px] text-slate-400">relationship</div>
        </div>

        <div className="text-center">
          <div className={`w-8 h-8 rounded-sm flex items-center justify-center text-xs font-bold ${
            personB.sex === 'M' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'
          }`}>
            {personB.givenName[0]}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 max-w-[60px] truncate">
            {personB.givenName}
          </div>
        </div>
      </div>
    </div>
  );
}
