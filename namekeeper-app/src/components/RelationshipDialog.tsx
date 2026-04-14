'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { GedcomData, Person } from '@/lib/types';
import { useFamilyTreeStore } from '@/lib/store';
import PersonSelector from './PersonSelector';

export type RelationshipMode = 'add-partner' | 'add-child' | 'add-sibling' | 'add-parents' | 'add-godparent';

// Legacy aliases the rest of the codebase still uses
export type LegacyRelationshipMode = RelationshipMode | 'marriage' | 'add-parent';

const MODE_ALIASES: Record<string, RelationshipMode> = {
  'marriage': 'add-partner',
  'add-parent': 'add-parents',
};

interface Props {
  open: boolean;
  mode: LegacyRelationshipMode;
  anchorPersonId?: string;
  data: GedcomData;
  onClose: () => void;
}

const TITLES: Record<RelationshipMode, string> = {
  'add-partner': 'Add Partner',
  'add-child': 'Add Child',
  'add-sibling': 'Add Sibling',
  'add-parents': 'Add Parents',
  'add-godparent': 'Add Godparent',
};

export default function RelationshipDialog({ open, mode, anchorPersonId, data, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const normalizedMode = (MODE_ALIASES[mode] || mode) as RelationshipMode;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open || !data || !anchorPersonId) return null;
  const anchor = data.persons.get(anchorPersonId);
  if (!anchor) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 p-0 backdrop:bg-black/30"
    >
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">{TITLES[normalizedMode]}</h2>
        <p className="text-xs text-slate-400 mt-1">
          for {anchor.givenName} {anchor.surname}
        </p>
      </div>

      {normalizedMode === 'add-partner' && <AddPartnerWizard anchor={anchor} data={data} onDone={onClose} />}
      {normalizedMode === 'add-child' && <AddChildWizard anchor={anchor} data={data} onDone={onClose} />}
      {normalizedMode === 'add-sibling' && <AddSiblingWizard anchor={anchor} data={data} onDone={onClose} />}
      {normalizedMode === 'add-parents' && <AddParentsWizard anchor={anchor} data={data} onDone={onClose} />}
      {normalizedMode === 'add-godparent' && <AddGodparentWizard anchor={anchor} data={data} onDone={onClose} />}
    </dialog>
  );
}

// ── Shared types ──────────────────────────────────────────────────────

type PersonChoice =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; data: Omit<Person, 'id'> }
  | null;

interface MiniDraft {
  givenName: string;
  surname: string;
  sex: 'M' | 'F' | 'U';
  birthDate: string;
  isLiving: boolean;
}

const emptyDraft = (sex: 'M' | 'F' | 'U' = 'U'): MiniDraft => ({
  givenName: '',
  surname: '',
  sex,
  birthDate: '',
  isLiving: true,
});

function draftToPerson(draft: MiniDraft): Omit<Person, 'id'> {
  return {
    givenName: draft.givenName.trim(),
    surname: draft.surname.trim(),
    sex: draft.sex,
    birthDate: draft.birthDate.trim() || undefined,
    isLiving: draft.isLiving,
    familiesAsSpouse: [],
    notes: [],
  };
}

const draftValid = (d: MiniDraft) => d.givenName.trim() !== '' && d.surname.trim() !== '';

// ── Add Partner ───────────────────────────────────────────────────────

function AddPartnerWizard({ anchor, data, onDone }: { anchor: Person; data: GedcomData; onDone: () => void }) {
  const store = useFamilyTreeStore();
  const partnerSex: 'M' | 'F' | 'U' = anchor.sex === 'M' ? 'F' : anchor.sex === 'F' ? 'M' : 'U';

  const [partner, setPartner] = useState<PersonChoice>(null);
  const [partnerType, setPartnerType] = useState<'current' | 'ex'>('current');
  const [marriageDate, setMarriageDate] = useState('');
  const [marriagePlace, setMarriagePlace] = useState('');

  const submit = () => {
    if (!partner) return;
    const partnerId = partner.kind === 'existing'
      ? partner.id
      : store.addPerson(partner.data);
    store.createMarriage(
      anchor.id,
      partnerId,
      marriageDate.trim() || undefined,
      marriagePlace.trim() || undefined,
      partnerType,
    );
    onDone();
  };

  const ready = partner !== null && (partner.kind === 'existing' || draftValidFromChoice(partner));

  return (
    <Body>
      <Section label="Partner">
        <PickOrCreate
          value={partner}
          onChange={setPartner}
          data={data}
          excludeIds={new Set([anchor.id])}
          defaultSex={partnerSex}
        />
      </Section>

      <Section label="Marriage">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" value={marriageDate} onChange={setMarriageDate} placeholder="e.g. 15 JUN 1990" />
          <TextField label="Place" value={marriagePlace} onChange={setMarriagePlace} />
        </div>
        <PartnerTypeToggle value={partnerType} onChange={setPartnerType} />
      </Section>

      <Footer onCancel={onDone} onConfirm={submit} disabled={!ready} confirmLabel="Create Marriage" />
    </Body>
  );
}

// ── Add Child ─────────────────────────────────────────────────────────

type ParentChoice =
  | { kind: 'existing-family'; familyId: string }
  | { kind: 'new-partner' }
  | { kind: 'solo' };

function AddChildWizard({ anchor, data, onDone }: { anchor: Person; data: GedcomData; onDone: () => void }) {
  const store = useFamilyTreeStore();
  const partnerSex: 'M' | 'F' | 'U' = anchor.sex === 'M' ? 'F' : anchor.sex === 'F' ? 'M' : 'U';

  const existingFamilies = useMemo(() => {
    return anchor.familiesAsSpouse
      .map((fid) => data.families.get(fid))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((fam) => {
        const otherId = fam.husbandId === anchor.id ? fam.wifeId : fam.husbandId;
        const other = otherId ? data.persons.get(otherId) : null;
        return { fam, other };
      });
  }, [anchor, data]);

  // Default to first existing family if any, else "new partner"
  const initialParent: ParentChoice = existingFamilies.length > 0
    ? { kind: 'existing-family', familyId: existingFamilies[0].fam.id }
    : { kind: 'new-partner' };

  const [parent, setParent] = useState<ParentChoice>(initialParent);
  const [newPartner, setNewPartner] = useState<PersonChoice>(null);
  const [newPartnerType, setNewPartnerType] = useState<'current' | 'ex'>('current');
  const [child, setChild] = useState<PersonChoice>(null);

  // Children take the male parent's surname by convention. Resolve it from
  // whichever parent role is male (anchor or other parent).
  const childSurname: string = (() => {
    if (anchor.sex === 'M') return anchor.surname;
    // Anchor is female (or unknown) — look to the other parent
    if (parent.kind === 'existing-family') {
      const fam = data.families.get(parent.familyId);
      const otherId = fam?.husbandId === anchor.id ? fam.wifeId : fam?.husbandId;
      const other = otherId ? data.persons.get(otherId) : null;
      if (other?.sex === 'M' && other.surname) return other.surname;
    }
    if (parent.kind === 'new-partner' && newPartner) {
      if (newPartner.kind === 'existing') {
        const ep = data.persons.get(newPartner.id);
        if (ep?.surname) return ep.surname;
      } else if (newPartner.data.surname) {
        return newPartner.data.surname;
      }
    }
    // Fall back to anchor's surname (e.g. solo parent or unknown other)
    return anchor.surname;
  })();

  const submit = () => {
    if (!child) return;

    // Resolve target family
    let familyId: string | null = null;

    if (parent.kind === 'existing-family') {
      familyId = parent.familyId;
    } else if (parent.kind === 'solo') {
      const isHusband = anchor.sex === 'M';
      familyId = store.addFamily({
        husbandId: isHusband ? anchor.id : undefined,
        wifeId: isHusband ? undefined : anchor.id,
        childIds: [],
      });
      const refreshed = useFamilyTreeStore.getState().data;
      const a = refreshed?.persons.get(anchor.id);
      if (a && !a.familiesAsSpouse.includes(familyId)) a.familiesAsSpouse.push(familyId);
    } else if (parent.kind === 'new-partner') {
      if (!newPartner) return;
      const partnerId = newPartner.kind === 'existing'
        ? newPartner.id
        : store.addPerson(newPartner.data);
      familyId = store.createMarriage(anchor.id, partnerId, undefined, undefined, newPartnerType);
    }

    if (!familyId) return;

    const childId = child.kind === 'existing'
      ? child.id
      : store.addPerson(child.data);

    store.addChildToFamily(familyId, childId);
    onDone();
  };

  const ready = (() => {
    if (!child) return false;
    if (child.kind === 'new' && !draftValidFromChoice(child)) return false;
    if (parent.kind === 'new-partner') {
      if (!newPartner) return false;
      if (newPartner.kind === 'new' && !draftValidFromChoice(newPartner)) return false;
    }
    return true;
  })();

  return (
    <Body>
      <Section label="Other Parent">
        <ul className="space-y-1">
          {existingFamilies.map(({ fam, other }) => (
            <RadioRow
              key={fam.id}
              selected={parent.kind === 'existing-family' && parent.familyId === fam.id}
              onClick={() => setParent({ kind: 'existing-family', familyId: fam.id })}
              label={other ? `with ${other.givenName} ${other.surname}` : 'with unknown spouse'}
              hint={fam.divorced ? 'ex' : undefined}
            />
          ))}
          <RadioRow
            selected={parent.kind === 'new-partner'}
            onClick={() => setParent({ kind: 'new-partner' })}
            label={existingFamilies.length > 0 ? '+ With a new partner' : '+ New partner'}
          />
          <RadioRow
            selected={parent.kind === 'solo'}
            onClick={() => setParent({ kind: 'solo' })}
            label={`Just ${anchor.givenName} (no other parent)`}
          />
        </ul>

        {parent.kind === 'new-partner' && (
          <div className="mt-3 pl-3 border-l-2 border-amber-200 space-y-3">
            <PickOrCreate
              value={newPartner}
              onChange={setNewPartner}
              data={data}
              excludeIds={new Set([anchor.id])}
              defaultSex={partnerSex}
              compact
            />
            <PartnerTypeToggle value={newPartnerType} onChange={setNewPartnerType} />
          </div>
        )}
      </Section>

      <Section label="Child">
        <PickOrCreate
          value={child}
          onChange={setChild}
          data={data}
          excludeIds={new Set([anchor.id])}
          defaultSurname={childSurname}
        />
      </Section>

      <Footer onCancel={onDone} onConfirm={submit} disabled={!ready} confirmLabel="Add Child" />
    </Body>
  );
}

// ── Add Sibling ───────────────────────────────────────────────────────

function AddSiblingWizard({ anchor, data, onDone }: { anchor: Person; data: GedcomData; onDone: () => void }) {
  const store = useFamilyTreeStore();
  const [sibling, setSibling] = useState<PersonChoice>(null);

  const birthFam = anchor.familyAsChild ? data.families.get(anchor.familyAsChild) : null;
  const fatherId = birthFam?.husbandId;
  const motherId = birthFam?.wifeId;
  const father = fatherId ? data.persons.get(fatherId) : null;
  const mother = motherId ? data.persons.get(motherId) : null;

  const submit = () => {
    if (!sibling) return;
    if (sibling.kind === 'existing') {
      store.linkSibling(anchor.id, sibling.id);
    } else {
      store.addSibling(anchor.id, sibling.data);
    }
    onDone();
  };

  const ready = sibling !== null && (sibling.kind === 'existing' || draftValidFromChoice(sibling));

  return (
    <Body>
      <Section label="Parents">
        {birthFam ? (
          <div className="text-xs text-slate-500">
            Will be added as a child of{' '}
            <span className="text-slate-700 font-medium">
              {father ? `${father.givenName} ${father.surname}` : 'unknown father'}
            </span>
            {' '}and{' '}
            <span className="text-slate-700 font-medium">
              {mother ? `${mother.givenName} ${mother.surname}` : 'unknown mother'}
            </span>
          </div>
        ) : (
          <div className="text-xs text-amber-600">
            {anchor.givenName} has no recorded parents. A placeholder family will be created.
          </div>
        )}
      </Section>

      <Section label="Sibling">
        <PickOrCreate
          value={sibling}
          onChange={setSibling}
          data={data}
          excludeIds={new Set([anchor.id])}
          defaultSurname={anchor.surname}
        />
      </Section>

      <Footer onCancel={onDone} onConfirm={submit} disabled={!ready} confirmLabel="Add Sibling" />
    </Body>
  );
}

// ── Add Parents ───────────────────────────────────────────────────────

function AddParentsWizard({ anchor, data, onDone }: { anchor: Person; data: GedcomData; onDone: () => void }) {
  const store = useFamilyTreeStore();

  const [father, setFather] = useState<PersonChoice>(null);
  const [mother, setMother] = useState<PersonChoice>(null);
  const [marriageDate, setMarriageDate] = useState('');

  const existingBirthFam = anchor.familyAsChild ? data.families.get(anchor.familyAsChild) : null;
  const alreadyHas = !!existingBirthFam;

  const submit = () => {
    if (!father && !mother) return;

    // Resolve father/mother either by linking existing or creating new
    const resolveOrCreate = (choice: PersonChoice, sex: 'M' | 'F'): string | undefined => {
      if (!choice) return undefined;
      if (choice.kind === 'existing') return choice.id;
      return store.addPerson({ ...choice.data, sex });
    };

    if (alreadyHas && existingBirthFam) {
      // Anchor already has a birth family — patch in missing parents instead of creating new
      const fatherId = resolveOrCreate(father, 'M');
      const motherId = resolveOrCreate(mother, 'F');
      const updates: Partial<typeof existingBirthFam> = {};
      if (fatherId && !existingBirthFam.husbandId) updates.husbandId = fatherId;
      if (motherId && !existingBirthFam.wifeId) updates.wifeId = motherId;
      if (Object.keys(updates).length > 0) {
        store.updateFamily(existingBirthFam.id, updates);
        // Backref the new parents
        const refreshed = useFamilyTreeStore.getState().data;
        if (fatherId) refreshed?.persons.get(fatherId)?.familiesAsSpouse.push(existingBirthFam.id);
        if (motherId) refreshed?.persons.get(motherId)?.familiesAsSpouse.push(existingBirthFam.id);
      }
    } else {
      // No birth family yet — create one and link both parents
      const fatherData = father?.kind === 'new' ? { ...father.data, sex: 'M' as const } : null;
      const motherData = mother?.kind === 'new' ? { ...mother.data, sex: 'F' as const } : null;

      // For "existing" choices, addParents doesn't handle — we wire them ourselves
      if (father?.kind === 'existing' || mother?.kind === 'existing') {
        const fatherId = father?.kind === 'existing' ? father.id : (fatherData ? store.addPerson(fatherData) : undefined);
        const motherId = mother?.kind === 'existing' ? mother.id : (motherData ? store.addPerson(motherData) : undefined);
        const familyId = store.addFamily({
          husbandId: fatherId,
          wifeId: motherId,
          childIds: [],
          marriageDate: marriageDate.trim() || undefined,
        });
        const refreshed = useFamilyTreeStore.getState().data;
        if (fatherId) refreshed?.persons.get(fatherId)?.familiesAsSpouse.push(familyId);
        if (motherId) refreshed?.persons.get(motherId)?.familiesAsSpouse.push(familyId);
        store.addChildToFamily(familyId, anchor.id);
      } else {
        store.addParents(anchor.id, fatherData, motherData, marriageDate.trim() || undefined);
      }
    }

    onDone();
  };

  const ready = (() => {
    if (!father && !mother) return false;
    if (father?.kind === 'new' && !draftValidFromChoice(father)) return false;
    if (mother?.kind === 'new' && !draftValidFromChoice(mother)) return false;
    return true;
  })();

  return (
    <Body>
      {alreadyHas && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {anchor.givenName} already has a recorded family. Any new parent will be added to it (existing parents are kept).
        </div>
      )}

      <Section label="Father">
        <PickOrCreate
          value={father}
          onChange={setFather}
          data={data}
          excludeIds={new Set([anchor.id])}
          defaultSex="M"
          defaultSurname={anchor.surname}
          allowEmpty
        />
      </Section>

      <Section label="Mother">
        <PickOrCreate
          value={mother}
          onChange={setMother}
          data={data}
          excludeIds={new Set([anchor.id])}
          defaultSex="F"
          allowEmpty
        />
      </Section>

      {!alreadyHas && (
        <Section label="Marriage">
          <TextField label="Date" value={marriageDate} onChange={setMarriageDate} placeholder="e.g. 12 SEP 1965" />
        </Section>
      )}

      <Footer onCancel={onDone} onConfirm={submit} disabled={!ready} confirmLabel="Add Parents" />
    </Body>
  );
}

// ── Add Godparent ─────────────────────────────────────────────────────

function AddGodparentWizard({ anchor, data, onDone }: { anchor: Person; data: GedcomData; onDone: () => void }) {
  const store = useFamilyTreeStore();

  type Source = 'tree' | 'external';
  const [source, setSource] = useState<Source>('tree');

  // tree branch
  const [linkedId, setLinkedId] = useState<string | null>(null);

  // external branch
  const [given, setGiven] = useState('');
  const [surname, setSurname] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'U'>('U');

  const submit = () => {
    if (source === 'tree') {
      if (!linkedId) return;
      store.addGodparent(anchor.id, { kind: 'linked', personId: linkedId });
    } else {
      if (!given.trim() || !surname.trim()) return;
      store.addGodparent(anchor.id, {
        kind: 'external',
        givenName: given.trim(),
        surname: surname.trim(),
        sex,
      });
    }
    onDone();
  };

  const ready = source === 'tree' ? !!linkedId : given.trim() !== '' && surname.trim() !== '';

  const linkedPerson = linkedId ? data.persons.get(linkedId) : null;

  return (
    <Body>
      <Section label="Godparent source">
        <ul className="space-y-1">
          <RadioRow
            selected={source === 'tree'}
            onClick={() => setSource('tree')}
            label="Select someone already on the tree"
          />
          <RadioRow
            selected={source === 'external'}
            onClick={() => setSource('external')}
            label="Add someone unrelated (not on the tree)"
          />
        </ul>
      </Section>

      {source === 'tree' ? (
        <Section label="Person">
          <PersonSelector
            data={data}
            excludeIds={new Set([anchor.id])}
            onSelect={(id) => setLinkedId(id)}
            placeholder="Type a name to search…"
          />
          {linkedPerson && (
            <div className="mt-2 flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded-lg text-sm text-amber-800">
              <span className="truncate">{linkedPerson.givenName} {linkedPerson.surname}</span>
              <button
                type="button"
                onClick={() => setLinkedId(null)}
                className="ml-auto text-amber-500 hover:text-amber-700 text-xs"
              >
                clear
              </button>
            </div>
          )}
        </Section>
      ) : (
        <Section label="Name">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={given}
              onChange={(e) => setGiven(e.target.value)}
              placeholder="Given name"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <input
              type="text"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              placeholder="Surname"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="flex gap-1 mt-2">
            {(['M', 'F', 'U'] as const).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setSex(s)}
                className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${
                  sex === s
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-amber-200'
                }`}
              >
                {s === 'M' ? 'Godfather' : s === 'F' ? 'Godmother' : 'Godparent'}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            They&rsquo;ll appear only on {anchor.givenName}&rsquo;s card — no node added to the tree.
          </p>
        </Section>
      )}

      <Footer onCancel={onDone} onConfirm={submit} disabled={!ready} confirmLabel="Add Godparent" />
    </Body>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────

function Body({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">{children}</div>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      {children}
    </div>
  );
}

function Footer({
  onCancel, onConfirm, disabled, confirmLabel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  confirmLabel: string;
}) {
  return (
    <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function RadioRow({
  selected, onClick, label, hint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg border transition-colors ${
          selected
            ? 'bg-amber-50 border-amber-300 text-amber-800'
            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <span
          className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 ${
            selected ? 'border-amber-500 bg-amber-500' : 'border-slate-300 bg-white'
          }`}
        />
        <span className="flex-1 truncate">{label}</span>
        {hint && (
          <span className="text-[10px] uppercase tracking-wider text-slate-400">{hint}</span>
        )}
      </button>
    </li>
  );
}

function PartnerTypeToggle({
  value, onChange,
}: {
  value: 'current' | 'ex';
  onChange: (v: 'current' | 'ex') => void;
}) {
  return (
    <div className="flex gap-2 mt-3">
      {(['current', 'ex'] as const).map((t) => (
        <button
          type="button"
          key={t}
          onClick={() => onChange(t)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium uppercase tracking-wider rounded-lg border transition-colors ${
            value === t
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-white text-slate-500 border-slate-200 hover:text-amber-700 hover:border-amber-200'
          }`}
        >
          {t === 'current' ? 'Current Partner' : 'Ex Partner'}
        </button>
      ))}
    </div>
  );
}

function TextField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
    </label>
  );
}

// ── PickOrCreate: link-existing vs create-new ─────────────────────────

interface PickOrCreateProps {
  value: PersonChoice;
  onChange: (v: PersonChoice) => void;
  data: GedcomData;
  excludeIds?: Set<string>;
  defaultSex?: 'M' | 'F' | 'U';
  defaultSurname?: string;
  compact?: boolean;
  allowEmpty?: boolean;
}

function PickOrCreate({
  value, onChange, data, excludeIds, defaultSex = 'U', defaultSurname, compact, allowEmpty,
}: PickOrCreateProps) {
  // Mode is derived from value when set; otherwise default to 'create' (Family Echo style)
  const initialMode: 'create' | 'link' = value?.kind === 'existing' ? 'link' : 'create';
  const [mode, setMode] = useState<'create' | 'link'>(initialMode);

  const [draft, setDraft] = useState<MiniDraft>(() => ({
    ...emptyDraft(defaultSex),
    surname: defaultSurname || '',
  }));

  // Track the last default we auto-filled so we can update it when the
  // upstream default changes — but only if the user hasn't typed a custom one.
  const lastDefaultSurnameRef = useRef(defaultSurname || '');
  useEffect(() => {
    const last = lastDefaultSurnameRef.current;
    if (defaultSurname !== last && (draft.surname === last || draft.surname === '')) {
      setDraft((d) => ({ ...d, surname: defaultSurname || '' }));
      lastDefaultSurnameRef.current = defaultSurname || '';
    } else {
      lastDefaultSurnameRef.current = defaultSurname || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSurname]);

  // Push draft changes upward so the wizard can validate / submit
  useEffect(() => {
    if (mode === 'create') {
      if (draftValid(draft)) {
        onChange({ kind: 'new', data: draftToPerson(draft) });
      } else if (value?.kind !== 'existing') {
        // Empty draft = pretend no choice yet, unless allowEmpty
        if (!allowEmpty && value !== null) onChange(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, mode]);

  const selectedExisting = value?.kind === 'existing' ? data.persons.get(value.id) : null;

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex gap-1 text-[10px] uppercase tracking-wider">
        <button
          type="button"
          onClick={() => { setMode('create'); if (draftValid(draft)) onChange({ kind: 'new', data: draftToPerson(draft) }); else onChange(null); }}
          className={`px-2 py-1 rounded ${mode === 'create' ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Create new
        </button>
        <button
          type="button"
          onClick={() => { setMode('link'); onChange(null); }}
          className={`px-2 py-1 rounded ${mode === 'link' ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Link existing
        </button>
      </div>

      {mode === 'create' ? (
        <MiniPersonForm draft={draft} onChange={setDraft} compact={compact} fixedSex={defaultSex !== 'U' ? defaultSex : undefined} />
      ) : (
        <>
          <PersonSelector
            data={data}
            excludeIds={excludeIds}
            onSelect={(id) => onChange({ kind: 'existing', id })}
            placeholder="Type a name to search…"
          />
          {selectedExisting && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded-lg text-sm text-amber-800">
              <span className="truncate">{selectedExisting.givenName} {selectedExisting.surname}</span>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="ml-auto text-amber-500 hover:text-amber-700 text-xs"
              >
                clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MiniPersonForm({
  draft, onChange, compact, fixedSex,
}: {
  draft: MiniDraft;
  onChange: (d: MiniDraft) => void;
  compact?: boolean;
  fixedSex?: 'M' | 'F';
}) {
  const set = <K extends keyof MiniDraft>(key: K, value: MiniDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className={`space-y-2 ${compact ? '' : ''}`}>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={draft.givenName}
          onChange={(e) => set('givenName', e.target.value)}
          placeholder="Given name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <input
          type="text"
          value={draft.surname}
          onChange={(e) => set('surname', e.target.value)}
          placeholder="Surname"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          type="text"
          value={draft.birthDate}
          onChange={(e) => set('birthDate', e.target.value)}
          placeholder="Birth date (e.g. 15 JUN 1990)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        {!fixedSex ? (
          <div className="flex gap-1">
            {(['M', 'F', 'U'] as const).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => set('sex', s)}
                className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                  draft.sex === s
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-amber-200'
                }`}
              >
                {s === 'M' ? 'M' : s === 'F' ? 'F' : '?'}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-400 px-2">{fixedSex === 'M' ? 'Male' : 'Female'}</div>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={draft.isLiving}
          onChange={(e) => set('isLiving', e.target.checked)}
          className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
        />
        Living
      </label>
    </div>
  );
}

function draftValidFromChoice(c: PersonChoice): boolean {
  if (!c) return false;
  if (c.kind === 'existing') return true;
  return c.data.givenName.trim() !== '' && c.data.surname.trim() !== '';
}
