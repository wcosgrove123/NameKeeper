'use client';

import { useEffect, useState } from 'react';
import { Person, NameKeeperStats, WhatIfResult } from '@/lib/types';
import { formatOrdinal, formatRemoval } from '@/lib/namekeeper-stats';
import { MatriarchStats } from '@/lib/matriarch-stats';

export interface ConnectedFamily {
  surname: string;
  role: 'birth' | 'spouse';
}

interface PersonDetailProps {
  person: Person;
  nameKeeperStats?: NameKeeperStats | null;
  whatIfResult?: WhatIfResult | null;
  matriarchStats?: MatriarchStats | null;
  connectedFamilies?: ConnectedFamily[];
  onClose: () => void;
  onEdit?: () => void;
  onViewMatriarch?: () => void;
}

export default function PersonDetail({ person, nameKeeperStats, whatIfResult, matriarchStats, connectedFamilies, onClose, onEdit, onViewMatriarch }: PersonDetailProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200); // Wait for exit animation
  };

  return (
    <div
      className="absolute top-3 right-3 bg-white rounded-lg shadow-lg border border-slate-200 p-4 w-72 z-10 transition-all duration-200 ease-out"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.97)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-800">
            {person.givenName} {person.surname}
          </h3>
          {person.marriedName && person.marriedName !== person.surname && (
            <div className="text-xs text-slate-500">
              nee {person.marriedName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-xs text-amber-500 hover:text-amber-700 px-2 py-0.5 rounded hover:bg-amber-50 transition-colors"
            >
              Edit
            </button>
          )}
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          >
            x
          </button>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Sex</span>
          <span className="text-slate-700">
            {person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : 'Unknown'}
          </span>
        </div>

        {person.birthDate && (
          <div className="flex justify-between">
            <span className="text-slate-500">Born</span>
            <span className="text-slate-700">
              {person.birthDate}
              {person.birthPlace ? `, ${person.birthPlace}` : ''}
            </span>
          </div>
        )}

        {!person.isLiving && (
          <div className="flex justify-between">
            <span className="text-slate-500">Died</span>
            <span className="text-slate-700">
              {person.deathDate || 'Yes'}
              {person.deathPlace ? `, ${person.deathPlace}` : ''}
            </span>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-slate-500">Status</span>
          <span
            className={
              person.isLiving
                ? 'text-green-600 font-medium'
                : 'text-slate-400'
            }
          >
            {person.isLiving ? 'Living' : 'Deceased'}
          </span>
        </div>

        {person.occupation && (
          <div className="flex justify-between">
            <span className="text-slate-500">Occupation</span>
            <span className="text-slate-700">{person.occupation}</span>
          </div>
        )}
      </div>

      {/* Connected Families */}
      {connectedFamilies && connectedFamilies.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Appears In
          </div>
          <div className="flex flex-wrap gap-1.5">
            {connectedFamilies.map((cf) => (
              <span
                key={`${cf.surname}-${cf.role}`}
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  cf.role === 'birth'
                    ? 'bg-slate-100 text-slate-700'
                    : 'bg-blue-50 text-blue-700'
                }`}
              >
                {cf.surname}
                <span className="text-[10px] ml-1 opacity-60">
                  {cf.role === 'birth' ? 'birth' : 'marriage'}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* NameKeeper Stats Section */}
      {nameKeeperStats && person.sex === 'M' && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            NameKeeper Status
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Generation</span>
              <span className="font-semibold text-blue-700">
                {formatOrdinal(nameKeeperStats.nameKeeperGeneration)} Gen
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Prime Line</span>
              {nameKeeperStats.isOnPrimeLine ? (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">
                  Prime Successor
                </span>
              ) : (
                <span className="text-slate-600 text-xs">
                  {formatRemoval(nameKeeperStats.removalFromPrime)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Matriarch Stats Section */}
      {matriarchStats && person.sex === 'F' && (
        <div className="mt-3 pt-3 border-t border-pink-100">
          <div className="text-xs font-semibold text-pink-500 uppercase tracking-wider mb-2">
            Matriarch Stats
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Families Created</span>
              <span className="font-semibold text-amber-700">{matriarchStats.totalFamilies}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Patrilineal / Matrilineal</span>
              <span className="text-xs text-slate-600">
                {matriarchStats.patrilinealFamilies}p / {matriarchStats.matrilinealFamilies}m
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Names Merged</span>
              <span className="text-xs text-slate-600">{matriarchStats.namesMergedIn.length}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Generations</span>
              <span className="text-xs text-slate-600">Spanning {matriarchStats.generationDepth}</span>
            </div>
            {onViewMatriarch && (
              <button
                onClick={onViewMatriarch}
                className="w-full mt-1 px-3 py-1.5 text-xs bg-pink-50 text-pink-600 hover:bg-pink-100 rounded-lg transition-colors font-medium"
              >
                View Matriarch Tree
              </button>
            )}
          </div>
        </div>
      )}

      {/* What-If Result Section */}
      {whatIfResult && (
        <div className="mt-3 pt-3 border-t border-purple-100">
          <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider mb-2">
            What-If Succession
          </div>
          {whatIfResult.newNameKeeper ? (
            <div className="space-y-1.5 text-sm">
              <div className="text-slate-600">
                If this line died out, the name would pass to:
              </div>
              <div className="font-semibold text-purple-700">
                {whatIfResult.newNameKeeper.givenName} {whatIfResult.newNameKeeper.surname}
              </div>
              <div className="text-xs text-slate-400">
                via {whatIfResult.divergencePoint.givenName} {whatIfResult.divergencePoint.surname}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              No alternate male heir found. The name would go extinct.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
