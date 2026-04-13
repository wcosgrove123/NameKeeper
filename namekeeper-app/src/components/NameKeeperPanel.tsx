'use client';

import { NameKeeperResult } from '@/lib/types';

interface NameKeeperPanelProps {
  results: Map<string, NameKeeperResult[]>;
  selectedSurname: string | null;
  onSelectSurname: (surname: string) => void;
  selectedResult: NameKeeperResult | null;
}

export default function NameKeeperPanel({
  results,
  selectedSurname,
  onSelectSurname,
  selectedResult,
}: NameKeeperPanelProps) {
  // Sort surnames by total males descending
  const sortedSurnames = Array.from(results.entries())
    .map(([surname, res]) => ({
      surname,
      totalMales: res[0]?.totalMales || 0,
      livingMales: res[0]?.livingMales || 0,
      patriarchCount: res.length,
      hasNameKeeper: res.some((r) => r.currentNameKeeper !== null),
    }))
    .sort((a, b) => b.totalMales - a.totalMales);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Surname list */}
      <div className={`${selectedResult ? 'max-h-[40%]' : 'flex-1'} overflow-y-auto`}>
        <div className="p-3">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Surnames ({sortedSurnames.length})
          </h3>
          <div className="space-y-1">
            {sortedSurnames.map((s) => (
              <button
                key={s.surname}
                onClick={() => onSelectSurname(s.surname)}
                className={`
                  w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ease-out
                  ${
                    selectedSurname === s.surname
                      ? 'bg-amber-100 border border-amber-300 text-amber-900 shadow-sm'
                      : 'hover:bg-slate-100 text-slate-700 border border-transparent'
                  }
                `}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.surname}</span>
                  <span className="text-xs text-slate-400">
                    {s.livingMales}/{s.totalMales} living
                  </span>
                </div>
                {s.hasNameKeeper && (
                  <div className="text-xs text-green-600 mt-0.5">
                    Active line
                  </div>
                )}
                {!s.hasNameKeeper && (
                  <div className="text-xs text-slate-400 mt-0.5">
                    Extinct
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selected surname detail */}
      {selectedResult && (
        <div className="border-t border-slate-200 p-3 bg-slate-50 flex-1 overflow-y-auto min-h-0 animate-fade-slide-in">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            {selectedResult.surname} Succession
          </h3>

          {/* Succession chain */}
          <div className="space-y-1 mb-3">
            {selectedResult.successionChain.map((person, i) => {
              const isNameKeeper =
                person.id === selectedResult.currentNameKeeper?.id;
              const isPatriarch = person.id === selectedResult.patriarch.id;

              return (
                <div key={person.id} className="flex items-start gap-2 text-xs">
                  {/* Connector line */}
                  <div className="flex flex-col items-center w-4 flex-shrink-0">
                    {i > 0 && (
                      <div className="w-0.5 h-2 bg-amber-400" />
                    )}
                    <div
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        isNameKeeper
                          ? 'bg-red-500 ring-2 ring-red-200'
                          : isPatriarch
                          ? 'bg-amber-700'
                          : 'bg-amber-400'
                      }`}
                    />
                    {i < selectedResult.successionChain.length - 1 && (
                      <div className="w-0.5 flex-1 bg-amber-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-medium truncate ${
                        isNameKeeper ? 'text-red-700' : 'text-slate-700'
                      }`}
                    >
                      {person.givenName} {person.surname}
                      {isNameKeeper && (
                        <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                          NAME KEEPER
                        </span>
                      )}
                      {isPatriarch && (
                        <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">
                          PATRIARCH
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400">
                      {person.birthDate || '?'}
                      {!person.isLiving &&
                        ` - ${person.deathDate || '?'}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Branch stats */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-white rounded p-2 text-center">
              <div className="font-semibold text-green-700">
                {selectedResult.branches.filter((b) => b.status === 'active').length}
              </div>
              <div className="text-slate-500">Active</div>
            </div>
            <div className="bg-white rounded p-2 text-center">
              <div className="font-semibold text-slate-400">
                {selectedResult.branches.filter((b) => b.status === 'extinct').length}
              </div>
              <div className="text-slate-500">Extinct</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
