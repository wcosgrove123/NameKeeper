'use client';

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface FamilyNodeData {
  familyId: string;
  marriageDate?: string;
  /** Tooltip shown on hover — e.g. the ex-spouse name for step-child junctions */
  hoverLabel?: string;
}

function FamilyNodeComponent({ data }: NodeProps) {
  const d = data as unknown as FamilyNodeData;
  const year = d.marriageDate?.match(/(\d{4})/)?.[1];
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => d.hoverLabel && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Left handle - receives edge from husband */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      {/* Right handle - receives edge from wife */}
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      {/* Top handle (fallback target) */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      {/* Small dot for the union node */}
      <div
        className="w-2 h-2 rounded-full bg-slate-400 cursor-pointer"
        title={year ? `m. ${year}` : undefined}
      />

      {/* Hover tooltip for step-child junctions */}
      {showTooltip && d.hoverLabel && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
          {d.hoverLabel}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-800" />
        </div>
      )}

      {/* Bottom handle - sends edges to children */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
    </div>
  );
}

export default memo(FamilyNodeComponent);
