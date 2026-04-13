'use client';

import { useState, useEffect, useRef } from 'react';
import { Person } from '@/lib/types';

interface PersonFormDialogProps {
  person?: Person | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<Person, 'id'>) => void;
}

export default function PersonFormDialog({ person, open, onClose, onSave }: PersonFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [givenName, setGivenName] = useState('');
  const [surname, setSurname] = useState('');
  const [nickname, setNickname] = useState('');
  const [marriedName, setMarriedName] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'U'>('U');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [deathDate, setDeathDate] = useState('');
  const [deathPlace, setDeathPlace] = useState('');
  const [isLiving, setIsLiving] = useState(true);
  const [occupation, setOccupation] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (person) {
      setGivenName(person.givenName);
      setSurname(person.surname);
      setNickname(person.nickname || '');
      setMarriedName(person.marriedName || '');
      setSex(person.sex);
      setBirthDate(person.birthDate || '');
      setBirthPlace(person.birthPlace || '');
      setDeathDate(person.deathDate || '');
      setDeathPlace(person.deathPlace || '');
      setIsLiving(person.isLiving);
      setOccupation(person.occupation || '');
      setNotes(person.notes.join('\n'));
    } else {
      setGivenName('');
      setSurname('');
      setNickname('');
      setMarriedName('');
      setSex('U');
      setBirthDate('');
      setBirthPlace('');
      setDeathDate('');
      setDeathPlace('');
      setIsLiving(true);
      setOccupation('');
      setNotes('');
    }
  }, [person, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      givenName: givenName.trim(),
      surname: surname.trim(),
      nickname: nickname.trim() || undefined,
      marriedName: marriedName.trim() || undefined,
      sex,
      birthDate: birthDate.trim() || undefined,
      birthPlace: birthPlace.trim() || undefined,
      deathDate: deathDate.trim() || undefined,
      deathPlace: deathPlace.trim() || undefined,
      isLiving,
      occupation: occupation.trim() || undefined,
      familiesAsSpouse: person?.familiesAsSpouse || [],
      familyAsChild: person?.familyAsChild,
      notes: notes.trim() ? notes.trim().split('\n') : [],
    });
    onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 p-0 backdrop:bg-black/30"
    >
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">
            {person ? 'Edit Person' : 'Add Person'}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Given Name *</span>
              <input
                type="text"
                value={givenName}
                onChange={e => setGivenName(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Surname *</span>
              <input
                type="text"
                value={surname}
                onChange={e => setSurname(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Nickname</span>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Sex *</span>
              <select
                value={sex}
                onChange={e => setSex(e.target.value as 'M' | 'F' | 'U')}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="U">Unknown</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Birth Date</span>
              <input
                type="text"
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
                placeholder="e.g. 15 JUN 1967"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Birth Place</span>
              <input
                type="text"
                value={birthPlace}
                onChange={e => setBirthPlace(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isLiving}
                onChange={e => {
                  setIsLiving(e.target.checked);
                  if (e.target.checked) {
                    setDeathDate('');
                    setDeathPlace('');
                  }
                }}
                className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-sm text-slate-600">Living</span>
            </label>
          </div>

          {!isLiving && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Death Date</span>
                <input
                  type="text"
                  value={deathDate}
                  onChange={e => setDeathDate(e.target.value)}
                  placeholder="e.g. 21 DEC 1891"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Death Place</span>
                <input
                  type="text"
                  value={deathPlace}
                  onChange={e => setDeathPlace(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </label>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-slate-500">Married Name</span>
            <input
              type="text"
              value={marriedName}
              onChange={e => setMarriedName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">Occupation</span>
            <input
              type="text"
              value={occupation}
              onChange={e => setOccupation(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">Notes</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
            />
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
          >
            {person ? 'Save Changes' : 'Add Person'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
