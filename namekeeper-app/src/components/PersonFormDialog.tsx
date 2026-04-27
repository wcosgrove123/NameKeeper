'use client';

import { useState, useEffect, useRef } from 'react';
import { Person } from '@/lib/types';

interface PersonFormDialogProps {
  person?: Person | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<Person, 'id'>) => void;
}

type Tab = 'personal' | 'contact' | 'biography';

interface FormState {
  title: string;
  givenName: string;
  middleNames: string;
  nickname: string;
  surname: string;
  surnameAtBirth: string;
  suffix: string;
  sex: 'M' | 'F' | 'U';
  birthDate: string;
  birthPlace: string;
  isLiving: boolean;
  deathDate: string;
  deathPlace: string;
  photoUrl: string;
  email: string;
  website: string;
  homeTel: string;
  mobile: string;
  workTel: string;
  address: string;
  occupation: string;
  company: string;
  interests: string;
  activities: string;
  bioNotes: string;
  notes: string;
}

const EMPTY: FormState = {
  title: '', givenName: '', middleNames: '', nickname: '', surname: '', surnameAtBirth: '', suffix: '',
  sex: 'U', birthDate: '', birthPlace: '', isLiving: true, deathDate: '', deathPlace: '',
  photoUrl: '', email: '', website: '', homeTel: '', mobile: '', workTel: '', address: '',
  occupation: '', company: '', interests: '', activities: '', bioNotes: '', notes: '',
};

export default function PersonFormDialog({ person, open, onClose, onSave }: PersonFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('personal');
  const [form, setForm] = useState<FormState>(EMPTY);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setTab('personal');
    if (person) {
      setForm({
        title: person.title || '',
        givenName: person.givenName,
        middleNames: person.middleNames || '',
        nickname: person.nickname || '',
        surname: person.surname,
        surnameAtBirth: person.surnameAtBirth || '',
        suffix: person.suffix || '',
        sex: person.sex,
        birthDate: person.birthDate || '',
        birthPlace: person.birthPlace || '',
        isLiving: person.isLiving,
        deathDate: person.deathDate || '',
        deathPlace: person.deathPlace || '',
        photoUrl: person.photoUrl || '',
        email: person.email || '',
        website: person.website || '',
        homeTel: person.homeTel || '',
        mobile: person.mobile || '',
        workTel: person.workTel || '',
        address: person.address || '',
        occupation: person.occupation || '',
        company: person.company || '',
        interests: person.interests || '',
        activities: person.activities || '',
        bioNotes: person.bioNotes || '',
        notes: person.notes.join('\n'),
      });
    } else {
      setForm(EMPTY);
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
    const trim = (s: string) => s.trim() || undefined;
    onSave({
      title: trim(form.title),
      givenName: form.givenName.trim(),
      middleNames: trim(form.middleNames),
      nickname: trim(form.nickname),
      surname: form.surname.trim(),
      surnameAtBirth: trim(form.surnameAtBirth),
      suffix: trim(form.suffix),
      // Keep marriedName aligned with the current surname. If the user cleared
      // any married-name change (surname === surnameAtBirth), wipe marriedName
      // entirely so the load-time migration doesn't re-introduce stale data.
      marriedName: form.surname.trim() && form.surname.trim() !== (form.surnameAtBirth.trim() || form.surname.trim())
        ? form.surname.trim()
        : undefined,
      sex: form.sex,
      birthDate: trim(form.birthDate),
      birthPlace: trim(form.birthPlace),
      deathDate: trim(form.deathDate),
      deathPlace: trim(form.deathPlace),
      isLiving: form.isLiving,
      photoUrl: trim(form.photoUrl),
      email: trim(form.email),
      website: trim(form.website),
      homeTel: trim(form.homeTel),
      mobile: trim(form.mobile),
      workTel: trim(form.workTel),
      address: trim(form.address),
      occupation: trim(form.occupation),
      company: trim(form.company),
      interests: trim(form.interests),
      activities: trim(form.activities),
      bioNotes: trim(form.bioNotes),
      familiesAsSpouse: person?.familiesAsSpouse || [],
      familyAsChild: person?.familyAsChild,
      notes: form.notes.trim() ? form.notes.trim().split('\n') : [],
    });
    onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 z-50 m-auto w-[calc(100vw-1rem)] max-w-lg max-h-[calc(100svh-2rem)] rounded-xl bg-white shadow-2xl border border-slate-200 p-0 backdrop:bg-black/30 overflow-hidden"
    >
      <form onSubmit={handleSubmit}>
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100">
          <h2 className="text-base sm:text-lg font-semibold text-slate-800">
            {person ? 'Edit Person' : 'Add Person'}
          </h2>
        </div>

        {/* Tab bar */}
        <div className="relative border-b border-slate-100">
          <div className="grid grid-cols-3">
            <TabBtn label="Personal" active={tab === 'personal'} onClick={() => setTab('personal')} />
            <TabBtn label="Contact" active={tab === 'contact'} onClick={() => setTab('contact')} />
            <TabBtn label="Biography" active={tab === 'biography'} onClick={() => setTab('biography')} />
          </div>
          <div
            className="absolute bottom-0 h-[2px] bg-amber-500 transition-all duration-200 ease-out"
            style={{
              width: 'calc(100% / 3)',
              left: tab === 'personal' ? '0%' : tab === 'contact' ? '33.333%' : '66.666%',
            }}
          />
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-3 max-h-[55svh] sm:max-h-[60svh] overflow-y-auto">
          {tab === 'personal' && (
            <>
              <div className="grid grid-cols-[70px_1fr] gap-3">
                <Field label="Title" value={form.title} onChange={(v) => set('title', v)} placeholder="Mr / Dr" />
                <Field label="Given Names *" value={form.givenName} onChange={(v) => set('givenName', v)} required autoFocus />
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label="Middle Names" value={form.middleNames} onChange={(v) => set('middleNames', v)} placeholder="space-separated" />
                <Field label="Nickname" value={form.nickname} onChange={(v) => set('nickname', v)} />
              </div>
              <div className="grid grid-cols-[1fr_1fr_90px] gap-3">
                <Field label="Surname now *" value={form.surname} onChange={(v) => set('surname', v)} required />
                <Field label="Surname at birth" value={form.surnameAtBirth} onChange={(v) => set('surnameAtBirth', v)} placeholder="Maiden" />
                <Field label="Suffix" value={form.suffix} onChange={(v) => set('suffix', v)} placeholder="Jr / III" />
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Sex *</span>
                <select
                  value={form.sex}
                  onChange={(e) => set('sex', e.target.value as 'M' | 'F' | 'U')}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="U">Unknown</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Birth Date" value={form.birthDate} onChange={(v) => set('birthDate', v)} placeholder="e.g. 15 JUN 1967" />
                <Field label="Birth Place" value={form.birthPlace} onChange={(v) => set('birthPlace', v)} />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isLiving}
                  onChange={(e) => {
                    set('isLiving', e.target.checked);
                    if (e.target.checked) {
                      set('deathDate', '');
                      set('deathPlace', '');
                    }
                  }}
                  className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                />
                <span className="text-sm text-slate-600">Living</span>
              </label>
              {!form.isLiving && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Death Date" value={form.deathDate} onChange={(v) => set('deathDate', v)} placeholder="e.g. 21 DEC 1891" />
                  <Field label="Death Place" value={form.deathPlace} onChange={(v) => set('deathPlace', v)} />
                </div>
              )}
              <Field label="Photo URL" value={form.photoUrl} onChange={(v) => set('photoUrl', v)} placeholder="https://… or paste a link" />
              <p className="text-[11px] text-slate-400 -mt-2">Drag & drop a file onto the avatar in the side panel to use a local image instead.</p>
            </>
          )}

          {tab === 'contact' && (
            <>
              <Field label="Email" value={form.email} onChange={(v) => set('email', v)} type="email" />
              <Field label="Website" value={form.website} onChange={(v) => set('website', v)} placeholder="https://" />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Home" value={form.homeTel} onChange={(v) => set('homeTel', v)} placeholder="(610) 555-…" />
                <Field label="Mobile" value={form.mobile} onChange={(v) => set('mobile', v)} />
                <Field label="Work" value={form.workTel} onChange={(v) => set('workTel', v)} />
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Address</span>
                <textarea
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </label>
            </>
          )}

          {tab === 'biography' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Profession" value={form.occupation} onChange={(v) => set('occupation', v)} />
                <Field label="Company" value={form.company} onChange={(v) => set('company', v)} />
              </div>
              <Field label="Interests" value={form.interests} onChange={(v) => set('interests', v)} />
              <Field label="Activities" value={form.activities} onChange={(v) => set('activities', v)} />
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Bio notes</span>
                <textarea
                  value={form.bioNotes}
                  onChange={(e) => set('bioNotes', e.target.value)}
                  rows={4}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Other notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </label>
            </>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex justify-end gap-2 pb-safe-or-3">
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

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
        active ? 'text-amber-700' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text', required, autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
    </label>
  );
}
