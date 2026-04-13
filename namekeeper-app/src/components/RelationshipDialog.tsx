'use client';

import { useState, useEffect, useRef } from 'react';
import { GedcomData } from '@/lib/types';
import PersonSelector from './PersonSelector';

type RelationshipMode = 'marriage' | 'add-child' | 'add-parent';

interface RelationshipDialogProps {
  open: boolean;
  mode: RelationshipMode;
  anchorPersonId?: string;
  data: GedcomData;
  onClose: () => void;
  onCreateMarriage: (person1Id: string, person2Id: string, date?: string, place?: string) => void;
  onAddChild: (parentId: string, childId: string) => void;
  onAddParent: (childId: string, parentId: string) => void;
}

export default function RelationshipDialog({
  open,
  mode,
  anchorPersonId,
  data,
  onClose,
  onCreateMarriage,
  onAddChild,
  onAddParent,
}: RelationshipDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [marriageDate, setMarriageDate] = useState('');
  const [marriagePlace, setMarriagePlace] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setSelectedPersonId(null);
      setMarriageDate('');
      setMarriagePlace('');
    }
  }, [open]);

  if (!open || !data) return null;

  const anchorPerson = anchorPersonId ? data.persons.get(anchorPersonId) : null;
  const anchorName = anchorPerson ? `${anchorPerson.givenName} ${anchorPerson.surname}` : '';

  const titles: Record<RelationshipMode, string> = {
    'marriage': 'Create Marriage',
    'add-child': 'Add Child',
    'add-parent': 'Add Parent',
  };

  const handleSubmit = () => {
    if (!anchorPersonId || !selectedPersonId) return;

    switch (mode) {
      case 'marriage':
        onCreateMarriage(anchorPersonId, selectedPersonId, marriageDate || undefined, marriagePlace || undefined);
        break;
      case 'add-child':
        onAddChild(anchorPersonId, selectedPersonId);
        break;
      case 'add-parent':
        onAddParent(anchorPersonId, selectedPersonId);
        break;
    }
    onClose();
  };

  const excludeIds = new Set<string>();
  if (anchorPersonId) excludeIds.add(anchorPersonId);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 z-50 m-auto w-full max-w-sm rounded-xl bg-white shadow-2xl border border-slate-200 p-0 backdrop:bg-black/30"
    >
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">{titles[mode]}</h2>
        {anchorPerson && (
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'marriage' && `Select a spouse for ${anchorName}`}
            {mode === 'add-child' && `Select a child for ${anchorName}`}
            {mode === 'add-parent' && `Select a parent for ${anchorName}`}
          </p>
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        <PersonSelector
          data={data}
          excludeIds={excludeIds}
          onSelect={setSelectedPersonId}
          label={mode === 'marriage' ? 'Spouse' : mode === 'add-child' ? 'Child' : 'Parent'}
          placeholder="Type a name to search..."
        />

        {selectedPersonId && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg">
            <span className="text-sm text-amber-800">
              {data.persons.get(selectedPersonId)?.givenName} {data.persons.get(selectedPersonId)?.surname}
            </span>
            <button
              onClick={() => setSelectedPersonId(null)}
              className="ml-auto text-amber-500 hover:text-amber-700 text-xs"
            >
              clear
            </button>
          </div>
        )}

        {mode === 'marriage' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Marriage Date</span>
              <input
                type="text"
                value={marriageDate}
                onChange={e => setMarriageDate(e.target.value)}
                placeholder="e.g. 15 JUN 1990"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Marriage Place</span>
              <input
                type="text"
                value={marriagePlace}
                onChange={e => setMarriagePlace(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!selectedPersonId}
          className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {mode === 'marriage' ? 'Create Marriage' : mode === 'add-child' ? 'Add Child' : 'Add Parent'}
        </button>
      </div>
    </dialog>
  );
}
