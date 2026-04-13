'use client';

import { MatriarchStats, MatriarchFamily, formatMatriarchLabel } from '@/lib/matriarch-stats';

interface MatriarchViewProps {
  stats: MatriarchStats;
  onClose: () => void;
}

export default function MatriarchView({ stats, onClose }: MatriarchViewProps) {
  return (
    <div className="absolute top-0 left-0 bottom-0 w-96 bg-white shadow-2xl border-r border-slate-200 z-30 flex flex-col overflow-hidden animate-slide-in-left">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-pink-50 to-amber-50 shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-pink-500 font-medium uppercase tracking-wider mb-1">
              Matriarch View
            </div>
            <h2 className="text-lg font-bold text-slate-800">
              {stats.matriarch.givenName} {stats.maidenName}
            </h2>
            <div className="text-xs text-slate-500 mt-0.5">
              Married into {stats.marriedIntoSurname}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1"
          >
            x
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="bg-white/80 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-amber-700">{stats.totalFamilies}</div>
            <div className="text-[10px] text-slate-500">Families</div>
          </div>
          <div className="bg-white/80 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-blue-600">{stats.patrilinealFamilies}</div>
            <div className="text-[10px] text-slate-500">Patrilineal</div>
          </div>
          <div className="bg-white/80 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-purple-600">{stats.matrilinealFamilies}</div>
            <div className="text-[10px] text-slate-500">Matrilineal</div>
          </div>
        </div>

        {/* Names */}
        {stats.namesMergedIn.length > 0 && (
          <div className="mt-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Names merged in: </span>
            <span className="text-xs text-slate-600">
              {stats.namesMergedIn.join(', ')}
            </span>
          </div>
        )}
        {stats.namesBranchedOut.length > 0 && (
          <div className="mt-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Names branched out: </span>
            <span className="text-xs text-purple-600">
              {stats.namesBranchedOut.filter(n => n !== stats.marriedIntoSurname).join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Family tree */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Family Tree ({stats.generationDepth} generations)
        </div>
        <FamilyNode family={stats.rootFamily} primarySurname={stats.marriedIntoSurname} />
      </div>
    </div>
  );
}

function FamilyNode({ family, primarySurname, depth = 0 }: { family: MatriarchFamily; primarySurname: string; depth?: number }) {
  const label = family.generation === 0
    ? 'gen0'
    : formatMatriarchLabel(family.generation, family.birthOrderLabel, family.lineType);

  const husbName = family.husband ? family.husband.givenName : '?';
  const wifeName = family.wife ? family.wife.givenName : '?';
  const isMatrilineal = family.lineType === 'm';
  const isNewName = family.surname !== primarySurname;

  const dotColor = isMatrilineal
    ? 'bg-purple-400'
    : family.generation === 0
      ? 'bg-pink-400'
      : 'bg-amber-400';

  const borderColor = isMatrilineal ? 'border-purple-200' : 'border-amber-200';

  return (
    <div className={`${depth > 0 ? 'ml-4 pl-3 border-l-2 ' + borderColor : ''}`}>
      <div className="flex items-start gap-2 py-1.5 group">
        {/* Dot */}
        <div className={`w-2.5 h-2.5 rounded-full ${dotColor} mt-1 shrink-0`} />

        <div className="min-w-0">
          {/* Label */}
          <span className="text-[10px] font-mono text-slate-400 mr-1.5">{label}</span>

          {/* Names */}
          <span className="text-xs text-slate-700">
            {husbName} + {wifeName}
          </span>
          <span className={`text-xs font-medium ml-1 ${isNewName ? 'text-purple-600' : 'text-amber-700'}`}>
            {family.surname}
          </span>

          {/* Child count */}
          {family.childCount > 0 && (
            <span className="text-[10px] text-slate-400 ml-1">
              ({family.childCount})
            </span>
          )}

          {/* New name badge */}
          {isMatrilineal && isNewName && (
            <span className="ml-1.5 px-1.5 py-0.5 text-[9px] bg-purple-100 text-purple-600 rounded-full font-medium">
              new name
            </span>
          )}
        </div>
      </div>

      {/* Sub-families */}
      {family.subFamilies.map((sub, i) => (
        <FamilyNode
          key={`${sub.familyId}-${i}`}
          family={sub}
          primarySurname={primarySurname}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
