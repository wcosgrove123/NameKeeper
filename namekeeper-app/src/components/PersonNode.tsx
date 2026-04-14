'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface PersonNodeData {
  personId: string;
  label: string;
  surname: string;
  birthDate?: string;
  deathDate?: string;
  sex: 'M' | 'F' | 'U';
  isLiving: boolean;
  isSelected: boolean;
  isBloodRelative: boolean;
  /** Non-blood spouse has a birth family that can be expanded */
  hasInLawFamily: boolean;
  /** This spouse's birth family is currently expanded */
  isInLawExpanded: boolean;
  collapsedAncestorCount?: number;
  collapsedDescendantCount?: number;
  hasParents: boolean;
  hasChildren: boolean;
  relationshipLabel?: string;
  /** When the currently-selected person has THIS node as a godparent. */
  isGodparentOfSelected?: boolean;
  /** In the Relationship view, the second of the two queried people
   *  (the END input). Rendered with a distinct highlight so it is
   *  visually distinguishable from the START person. */
  isEndSelection?: boolean;
}

function PersonNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PersonNodeData;
  const isMale = d.sex === 'M';
  const isFemale = d.sex === 'F';

  const birthYear = d.birthDate?.match(/(\d{4})/)?.[1] || '';
  const deathYear = d.deathDate?.match(/(\d{4})/)?.[1] || '';
  const dateStr = birthYear
    ? deathYear
      ? `${birthYear}-${deathYear}`
      : d.isLiving
        ? `b. ${birthYear}`
        : `${birthYear}-?`
    : '';

  const bgColor = d.isSelected
    ? 'bg-amber-100 border-amber-500'
    : d.isEndSelection
      ? 'bg-violet-100 border-violet-500'
      : d.isGodparentOfSelected
      ? isMale
        ? 'bg-blue-50 border-blue-600'
        : isFemale
          ? 'bg-pink-50 border-pink-600'
          : 'bg-slate-50 border-slate-500'
      : isMale
        ? d.isLiving
          ? 'bg-blue-50 border-blue-300'
          : 'bg-blue-50/50 border-blue-200'
        : isFemale
          ? d.isLiving
            ? 'bg-pink-50 border-pink-300'
            : 'bg-pink-50/50 border-pink-200'
          : 'bg-gray-50 border-gray-300';

  const borderWidth = d.isGodparentOfSelected ? 'border-[3px]' : 'border-2';

  const textColor = d.isLiving ? 'text-slate-800' : 'text-slate-400';

  return (
    <>
      {/* Ancestor count bubble — positioned outside the node bounds */}
      {(d.collapsedAncestorCount ?? 0) > 0 && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center z-10 cursor-pointer shadow-sm">
          {d.collapsedAncestorCount}
        </div>
      )}

      {/* Descendant count bubble — positioned outside the node bounds */}
      {(d.collapsedDescendantCount ?? 0) > 0 && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center z-10 cursor-pointer shadow-sm">
          {d.collapsedDescendantCount}
        </div>
      )}

      {/* In-law family expand/collapse indicator */}
      {d.hasInLawFamily && (
        <div
          className={`absolute -top-3 -right-3 text-white text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center z-10 cursor-pointer shadow-sm ${
            d.isInLawExpanded ? 'bg-orange-400' : 'bg-violet-500'
          }`}
          title={d.isInLawExpanded ? 'Collapse in-law family' : 'Show in-law family'}
          data-inlaw-toggle={d.personId}
        >
          {d.isInLawExpanded ? '−' : '+'}
        </div>
      )}

      {/* Handles */}
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right-target" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left-target" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Node body — this IS the node, handles attach to its edges */}
      <div
        className={`
          rounded-lg ${borderWidth} shadow-sm cursor-pointer
          transition-colors w-[200px] h-[80px] flex flex-col items-center justify-center
          text-center overflow-hidden
          ${bgColor}
        `}
      >
        {d.relationshipLabel && (
          <div className="text-[9px] font-medium text-purple-500 uppercase tracking-wider mb-0.5 truncate max-w-[180px]">
            {d.relationshipLabel}
          </div>
        )}
        <div className={`text-xs font-semibold leading-tight truncate max-w-[180px] ${textColor}`}>
          {d.label}
        </div>
        {dateStr && (
          <div className="text-[10px] text-slate-400 mt-0.5">
            {dateStr}
          </div>
        )}
      </div>
    </>
  );
}

export default memo(PersonNodeComponent);
