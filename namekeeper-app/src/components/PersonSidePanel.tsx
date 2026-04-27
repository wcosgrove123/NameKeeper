'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Person, NameKeeperStats, WhatIfResult, GedcomData } from '@/lib/types';
import { formatOrdinal, formatRemoval } from '@/lib/namekeeper-stats';
import { MatriarchStats } from '@/lib/matriarch-stats';
import { countAncestors, countDescendants, resolveBiography, formatPersonName } from '@/lib/person-graph-stats';
import { isExFamily } from '@/lib/family-status';
import { resolvePhotoUrl, savePhotoBlob, IDB_PHOTO_PREFIX } from '@/lib/photo-storage';

export interface ConnectedFamily {
  surname: string;
  role: 'birth' | 'spouse';
}

type Tab = 'personal' | 'contact' | 'biography';

interface PersonSidePanelProps {
  person: Person;
  data: GedcomData;
  nameKeeperStats?: NameKeeperStats | null;
  whatIfResult?: WhatIfResult | null;
  matriarchStats?: MatriarchStats | null;
  connectedFamilies?: ConnectedFamily[];
  onClose: () => void;
  onEdit?: () => void;
  onViewMatriarch?: () => void;
  onAddSpouse?: (person: Person) => void;
  onAddSibling?: (person: Person) => void;
  onAddChild?: (person: Person) => void;
  onAddParent?: (person: Person) => void;
  onAddParents?: (person: Person) => void;
  onCenterPerson?: (person: Person) => void;
  onDelete?: (person: Person) => void;
  onAddGodparent?: (person: Person) => void;
  onRemoveGodparent?: (personId: string, index: number) => void;
  onSelectPerson?: (personId: string) => void;
  onPhotoChange?: (personId: string, photoUrl: string) => void;
  onSetDivorced?: (familyId: string, divorced: boolean) => void;
  /** Click the person's name in the header → "open in tree view". */
  onOpenInTreeView?: (personId: string) => void;
  /** Click an "Appears in" surname chip → "open the namekeeper surname tree". */
  onOpenSurnameTree?: (surname: string, personId: string) => void;
}

export default function PersonSidePanel({
  person,
  data,
  nameKeeperStats,
  whatIfResult,
  matriarchStats,
  connectedFamilies,
  onClose,
  onEdit,
  onViewMatriarch,
  onAddSpouse,
  onAddSibling,
  onAddChild,
  onAddParent,
  onAddParents,
  onCenterPerson,
  onDelete,
  onAddGodparent,
  onRemoveGodparent,
  onSelectPerson,
  onPhotoChange,
  onSetDivorced,
  onOpenInTreeView,
  onOpenSurnameTree,
}: PersonSidePanelProps) {
  const [visible, setVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>('personal');
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Esc dismisses the panel entirely (since the X button is gone)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightbox) handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox]);

  // Resolve photo to a browser-usable URL; revoke object URLs on change.
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    resolvePhotoUrl(person.photoUrl).then((url) => {
      if (cancelled) {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      setPhotoSrc(url);
      if (url && url.startsWith('blob:')) revoke = url;
    });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [person.photoUrl, person.id]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const handlePhotoFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const sentinel = await savePhotoBlob(person.id, file);
    onPhotoChange?.(person.id, sentinel);
    // Immediate preview
    const objectUrl = URL.createObjectURL(file);
    setPhotoSrc(objectUrl);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingPhoto(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePhotoFile(file);
  };

  const ancestors = useMemo(() => countAncestors(person.id, data), [person.id, data]);
  const descendants = useMemo(() => countDescendants(person.id, data), [person.id, data]);
  const bio = useMemo(() => resolveBiography(person), [person]);

  const birthYear = extractYear(person.birthDate);
  const deathYear = extractYear(person.deathDate);
  const years = person.isLiving
    ? birthYear ? `b. ${birthYear}` : ''
    : `${birthYear ?? '?'} – ${deathYear ?? '?'}`;

  const sexTint =
    person.sex === 'M' ? 'from-blue-50' : person.sex === 'F' ? 'from-pink-50' : 'from-slate-50';
  const sexAccent =
    person.sex === 'M' ? 'text-blue-700' : person.sex === 'F' ? 'text-pink-700' : 'text-slate-600';

  // Contact tab data
  const hasContact = !!(person.email || person.website || person.homeTel || person.mobile || person.workTel || person.address);
  // Biography tab data
  const hasBio = !!(person.birthPlace || person.occupation || person.company || bio.interests || bio.activities || bio.bioNotes);

  return (
    <>
      <div
        className="bg-white rounded-xl border border-slate-200/80 w-full max-h-full overflow-hidden flex flex-col transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_-2px_rgba(15,23,42,0.08),0_24px_48px_-16px_rgba(15,23,42,0.18)]"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.97)',
        }}
      >
        {/* Drag-handle pill — visible on phones (where this card is a bottom
            sheet), hidden on tablet+. Purely visual; doesn't drive a gesture. */}
        <div
          className="md:hidden shrink-0 flex justify-center pt-1.5 pb-0.5 cursor-pointer"
          onClick={handleClose}
          aria-hidden="true"
        >
          <div className="h-1 w-9 rounded-full bg-slate-300" />
        </div>
        {/* Header with sex-tinted gradient strip */}
        <div
          className={`shrink-0 relative bg-gradient-to-b ${sexTint} ${collapsed ? '' : 'to-white border-b border-slate-100'} px-4 pt-4 pb-3`}
        >
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand details' : 'Collapse details'}
            aria-expanded={!collapsed}
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-white/60 rounded-md transition-colors"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <div className="flex items-start gap-3">
            {/* Photo slot */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingPhoto(true); }}
              onDragLeave={() => setIsDraggingPhoto(false)}
              onDrop={onDrop}
              onClick={() => (photoSrc ? setLightbox(true) : fileInputRef.current?.click())}
              className={`relative shrink-0 w-[72px] h-[72px] rounded-lg overflow-hidden cursor-pointer bg-white ring-1 transition-all ${
                isDraggingPhoto ? 'ring-2 ring-amber-500 scale-[1.02]' : 'ring-slate-200 hover:ring-slate-300'
              }`}
              title={photoSrc ? 'Click to enlarge · drop to replace' : 'Click or drop an image'}
            >
              {photoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoSrc} alt={person.givenName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="9" r="3.5" />
                    <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
                  </svg>
                  <span className="text-[9px] mt-0.5 tracking-wide uppercase">Drop</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePhotoFile(f);
                }}
              />
            </div>

            {/* Name + years */}
            <div className="min-w-0 flex-1 pr-6">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                {person.title || (person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : '\u00A0')}
              </div>
              {onOpenInTreeView ? (
                <button
                  type="button"
                  onClick={() => onOpenInTreeView(person.id)}
                  title="Open in Tree View"
                  className="font-semibold text-slate-800 leading-tight truncate text-left hover:text-amber-700 hover:underline transition-colors w-full"
                >
                  {formatPersonName(person)}
                </button>
              ) : (
                <h3 className="font-semibold text-slate-800 leading-tight truncate">
                  {formatPersonName(person)}
                </h3>
              )}
              {person.nickname && (
                <div className="text-xs text-slate-500 italic truncate">“{person.nickname}”</div>
              )}
              {years && (
                <div className={`text-xs font-medium mt-0.5 ${sexAccent}`}>{years}</div>
              )}
              {person.surnameAtBirth && person.surnameAtBirth !== person.surname && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  née <span className="text-slate-700">{person.surnameAtBirth}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {!collapsed && (
        <>
        {/* Tab bar */}
        <div className="shrink-0 relative border-b border-slate-100">
          <div className="grid grid-cols-3">
            <TabButton label="Personal" active={tab === 'personal'} onClick={() => setTab('personal')} />
            <TabButton label="Contact" active={tab === 'contact'} onClick={() => setTab('contact')} />
            <TabButton label="Biography" active={tab === 'biography'} onClick={() => setTab('biography')} />
          </div>
          {/* Sliding underline */}
          <div
            className="absolute bottom-0 h-[2px] bg-amber-500 transition-all duration-200 ease-out"
            style={{
              width: 'calc(100% / 3)',
              left: tab === 'personal' ? '0%' : tab === 'contact' ? '33.333%' : '66.666%',
            }}
          />
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 p-4 text-sm overflow-y-auto">
          {tab === 'personal' && (
            <PersonalTab
              person={person}
              data={data}
              ancestors={ancestors}
              descendants={descendants}
              connectedFamilies={connectedFamilies}
              nameKeeperStats={nameKeeperStats}
              matriarchStats={matriarchStats}
              whatIfResult={whatIfResult}
              onViewMatriarch={onViewMatriarch}
              onSetDivorced={onSetDivorced}
              onSelectPerson={onSelectPerson}
              onRemoveGodparent={onRemoveGodparent}
              onOpenSurnameTree={onOpenSurnameTree}
            />
          )}
          {tab === 'contact' && (
            hasContact ? <ContactTab person={person} /> : <EmptyState label="No contact details recorded." />
          )}
          {tab === 'biography' && (
            hasBio
              ? <BiographyTab
                  birthPlace={person.birthPlace}
                  occupation={person.occupation}
                  company={person.company}
                  interests={bio.interests}
                  activities={bio.activities}
                  bioNotes={bio.bioNotes}
                />
              : <EmptyState label="No biography recorded." />
          )}
        </div>

        {/* Action footer */}
        {(onEdit || onAddSpouse || onAddSibling || onAddChild || onAddParent || onAddParents || onCenterPerson || onDelete) && (
          <div className="shrink-0 px-4 py-3 bg-slate-50/70 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
            {onEdit && <ActionButton label="Edit" onClick={onEdit} primary />}
            {onCenterPerson && <ActionButton label="Center" onClick={() => onCenterPerson(person)} />}
            {(onAddSpouse || onAddSibling || onAddChild || onAddParent || onAddParents || onAddGodparent) && (
              <AddMenu
                onAddPartner={onAddSpouse ? () => onAddSpouse(person) : undefined}
                onAddSibling={onAddSibling ? () => onAddSibling(person) : undefined}
                onAddChild={onAddChild ? () => onAddChild(person) : undefined}
                onAddParents={
                  onAddParents ? () => onAddParents(person)
                  : onAddParent ? () => onAddParent(person)
                  : undefined
                }
                onAddGodparent={onAddGodparent ? () => onAddGodparent(person) : undefined}
              />
            )}
            {onDelete && (
              <>
                <span className="flex-1" />
                <ActionButton label="Delete" onClick={() => onDelete(person)} danger />
              </>
            )}
          </div>
        )}
        </>
        )}
      </div>

      {/* Photo lightbox */}
      {lightbox && photoSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out"
          onClick={() => setLightbox(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoSrc}
            alt={person.givenName}
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
        active ? 'text-amber-700' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({ label, onClick, primary, danger }: { label: string; onClick: () => void; primary?: boolean; danger?: boolean }) {
  const style = danger
    ? 'bg-white text-red-500 hover:text-white hover:bg-red-500 border-red-200 hover:border-red-500'
    : primary
    ? 'bg-amber-500 text-white hover:bg-amber-600 border-amber-500'
    : 'bg-white text-slate-600 hover:text-amber-700 hover:bg-amber-50 border-slate-200 hover:border-amber-200';
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-medium border rounded-md transition-colors ${style}`}
    >
      {label}
    </button>
  );
}

function AddMenu({
  onAddPartner, onAddSibling, onAddChild, onAddParents, onAddGodparent,
}: {
  onAddPartner?: () => void;
  onAddSibling?: () => void;
  onAddChild?: () => void;
  onAddParents?: () => void;
  onAddGodparent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const items = [
    { label: 'Partner',   hint: 'spouse / ex',         onClick: onAddPartner },
    { label: 'Sibling',   hint: 'shares parents',      onClick: onAddSibling },
    { label: 'Child',     hint: 'with chosen parent',  onClick: onAddChild },
    { label: 'Parents',   hint: 'father / mother',     onClick: onAddParents },
    { label: 'Godparent', hint: 'godfather / mother',  onClick: onAddGodparent },
  ].filter((i) => !!i.onClick);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border rounded-md transition-colors ${
          open
            ? 'bg-amber-50 text-amber-700 border-amber-300'
            : 'bg-white text-slate-600 hover:text-amber-700 hover:bg-amber-50 border-slate-200 hover:border-amber-200'
        }`}
      >
        Add
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full mb-1.5 left-0 z-30 min-w-[170px] rounded-lg border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-6px_rgba(15,23,42,0.18)] py-1 origin-bottom-left"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { item.onClick?.(); setOpen(false); }}
              className="w-full flex items-baseline justify-between gap-3 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800 transition-colors"
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-[10px] text-slate-400 group-hover:text-amber-500">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-700 text-right min-w-0 break-words">{value}</span>
    </div>
  );
}

function DateRow({ label, date, place }: { label: string; date: string; place?: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 items-start">
      <span className="text-slate-500 shrink-0 leading-tight">{label}</span>
      <div className="text-right min-w-0">
        <div className="text-slate-700 leading-tight">{date}</div>
        {place && (
          <div className="text-[11px] text-slate-400 leading-snug mt-0.5 break-words">
            {place}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' | 'pink' | 'purple' }) {
  const colorMap = {
    slate: 'text-slate-500',
    amber: 'text-amber-600',
    pink: 'text-pink-500',
    purple: 'text-purple-600',
  };
  return (
    <div className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${colorMap[tone]}`}>
      {children}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="py-8 text-center text-xs text-slate-400">{label}</div>;
}

function PersonalTab({
  person,
  data,
  ancestors,
  descendants,
  connectedFamilies,
  nameKeeperStats,
  matriarchStats,
  whatIfResult,
  onViewMatriarch,
  onSetDivorced,
  onSelectPerson,
  onRemoveGodparent,
  onOpenSurnameTree,
}: {
  person: Person;
  data: GedcomData;
  ancestors: number;
  descendants: number;
  connectedFamilies?: ConnectedFamily[];
  nameKeeperStats?: NameKeeperStats | null;
  matriarchStats?: MatriarchStats | null;
  whatIfResult?: WhatIfResult | null;
  onViewMatriarch?: () => void;
  onSetDivorced?: (familyId: string, divorced: boolean) => void;
  onSelectPerson?: (personId: string) => void;
  onRemoveGodparent?: (personId: string, index: number) => void;
  onOpenSurnameTree?: (surname: string, personId: string) => void;
}) {
  const marriages = person.familiesAsSpouse
    .map((fid) => {
      const fam = data.families.get(fid);
      if (!fam) return null;
      const spouseId = fam.husbandId === person.id ? fam.wifeId : fam.husbandId;
      const spouse = spouseId ? data.persons.get(spouseId) : null;
      return { fam, spouse };
    })
    .filter((m): m is { fam: NonNullable<ReturnType<typeof data.families.get>>; spouse: Person | null } => !!m)
    // Drop empty placeholder marriages: no other spouse AND no children.
    // These are dangling FAM records the source GEDCOM left behind.
    .filter((m) => m.spouse !== null || m.fam.childIds.length > 0);

  return (
    <div className="space-y-4">
      {/* Vitals */}
      <div className="space-y-0.5">
        <Row label="Gender" value={person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : 'Unknown'} />
        {person.birthDate && (
          <DateRow label="Born" date={person.birthDate} place={person.birthPlace} />
        )}
        {!person.isLiving && (
          <DateRow label="Died" date={person.deathDate || 'Yes'} place={person.deathPlace} />
        )}
        <div className="flex justify-between py-1">
          <span className="text-slate-500">Status</span>
          <span className={person.isLiving ? 'text-green-600 font-medium' : 'text-slate-400'}>
            {person.isLiving ? 'Living' : 'Deceased'}
          </span>
        </div>
      </div>

      {/* Tree stats plaque */}
      <div className="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2.5">
        <SectionLabel tone="amber">Tree Stats</SectionLabel>
        <div className="flex items-baseline gap-4">
          <div>
            <div className="text-xl font-semibold text-amber-700 leading-none">{ancestors}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">Ancestors</div>
          </div>
          <div className="w-px h-8 bg-amber-200" />
          <div>
            <div className="text-xl font-semibold text-amber-700 leading-none">{descendants}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">Descendants</div>
          </div>
        </div>
      </div>

      {/* Marriages */}
      {marriages.length > 0 && (
        <div>
          <SectionLabel>{marriages.length === 1 ? 'Marriage' : 'Marriages'}</SectionLabel>
          <ul className="space-y-1">
            {marriages.map(({ fam, spouse }) => {
              const ex = isExFamily(fam.id, data);
              return (
                <li key={fam.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-700 truncate">
                    {spouse ? `${spouse.givenName} ${spouse.surname}` : 'Unknown spouse'}
                    {ex && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-slate-400">ex</span>}
                  </span>
                  {onSetDivorced && (
                    <button
                      type="button"
                      onClick={() => onSetDivorced(fam.id, !ex)}
                      className={`shrink-0 px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border transition-colors ${
                        ex
                          ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                          : 'bg-white text-slate-500 border-slate-200 hover:text-amber-700 hover:border-amber-200'
                      }`}
                    >
                      {ex ? 'mark current' : 'mark divorced'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Godparents */}
      {person.godparents && person.godparents.length > 0 && (
        <div>
          <SectionLabel>{person.godparents.length === 1 ? 'Godparent' : 'Godparents'}</SectionLabel>
          <ul className="space-y-1">
            {person.godparents.map((gp, idx) => {
              const linked = gp.kind === 'linked' ? data.persons.get(gp.personId) : null;
              const name = linked
                ? `${linked.givenName} ${linked.surname}`
                : gp.kind === 'external' ? `${gp.givenName} ${gp.surname}` : 'Unknown';
              const sex = linked?.sex ?? (gp.kind === 'external' ? gp.sex : 'U');
              const role = sex === 'M' ? 'godfather' : sex === 'F' ? 'godmother' : 'godparent';
              return (
                <li key={idx} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                        sex === 'M' ? 'bg-blue-400' : sex === 'F' ? 'bg-pink-400' : 'bg-slate-400'
                      }`}
                    />
                    {linked && onSelectPerson ? (
                      <button
                        type="button"
                        onClick={() => onSelectPerson(linked.id)}
                        className="text-slate-700 hover:text-amber-700 hover:underline truncate text-left"
                      >
                        {name}
                      </button>
                    ) : (
                      <span className="text-slate-700 truncate">{name}</span>
                    )}
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 shrink-0">{role}</span>
                  </div>
                  {onRemoveGodparent && (
                    <button
                      type="button"
                      onClick={() => onRemoveGodparent(person.id, idx)}
                      title="Remove"
                      className="shrink-0 w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors text-base leading-none"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Connected families */}
      {connectedFamilies && connectedFamilies.length > 0 && (
        <div>
          <SectionLabel>Appears In</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {connectedFamilies.map((cf) => {
              const base = `px-2 py-0.5 rounded-full text-xs font-medium ${
                cf.role === 'birth' ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'
              }`;
              const inner = (
                <>
                  {cf.surname}
                  <span className="text-[10px] ml-1 opacity-60">{cf.role === 'birth' ? 'birth' : 'marriage'}</span>
                </>
              );
              return onOpenSurnameTree ? (
                <button
                  key={`${cf.surname}-${cf.role}`}
                  type="button"
                  onClick={() => onOpenSurnameTree(cf.surname, person.id)}
                  title={`Open ${cf.surname} succession tree`}
                  className={`${base} hover:ring-2 hover:ring-amber-300 transition-all`}
                >
                  {inner}
                </button>
              ) : (
                <span key={`${cf.surname}-${cf.role}`} className={base}>{inner}</span>
              );
            })}
          </div>
        </div>
      )}

      {/* NameKeeper stats */}
      {nameKeeperStats && person.sex === 'M' && (
        <div className="pt-3 border-t border-slate-100">
          <SectionLabel>NameKeeper Status</SectionLabel>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Generation</span>
              <span className="font-semibold text-blue-700">{formatOrdinal(nameKeeperStats.nameKeeperGeneration)} Gen</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Prime Line</span>
              {nameKeeperStats.isOnPrimeLine ? (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">Prime Successor</span>
              ) : (
                <span className="text-slate-600 text-xs">{formatRemoval(nameKeeperStats.removalFromPrime)}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Matriarch stats */}
      {matriarchStats && person.sex === 'F' && (
        <div className="pt-3 border-t border-pink-100">
          <SectionLabel tone="pink">Matriarch Stats</SectionLabel>
          <div className="space-y-1.5">
            <Row label="Families Created" value={<span className="font-semibold text-amber-700">{matriarchStats.totalFamilies}</span>} />
            <Row label="Patrilineal / Matrilineal" value={<span className="text-xs text-slate-600">{matriarchStats.patrilinealFamilies}p / {matriarchStats.matrilinealFamilies}m</span>} />
            <Row label="Names Merged" value={<span className="text-xs text-slate-600">{matriarchStats.namesMergedIn.length}</span>} />
            <Row label="Generations" value={<span className="text-xs text-slate-600">Spanning {matriarchStats.generationDepth}</span>} />
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

      {/* What-If */}
      {whatIfResult && (
        <div className="pt-3 border-t border-purple-100">
          <SectionLabel tone="purple">What-If Succession</SectionLabel>
          {whatIfResult.newNameKeeper ? (
            <div className="space-y-1 text-sm">
              <div className="text-slate-600 text-xs">If this line died out, the name would pass to:</div>
              <div className="font-semibold text-purple-700">
                {whatIfResult.newNameKeeper.givenName} {whatIfResult.newNameKeeper.surname}
              </div>
              <div className="text-xs text-slate-400">
                via {whatIfResult.divergencePoint.givenName} {whatIfResult.divergencePoint.surname}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">No alternate male heir found. The name would go extinct.</div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactTab({ person }: { person: Person }) {
  return (
    <div className="space-y-0.5">
      <Row label="Email" value={person.email && <a href={`mailto:${person.email}`} className="text-amber-700 hover:underline">{person.email}</a>} />
      <Row label="Website" value={person.website && <a href={person.website} target="_blank" rel="noreferrer" className="text-amber-700 hover:underline">{person.website}</a>} />
      <Row label="Home" value={person.homeTel} />
      <Row label="Mobile" value={person.mobile} />
      <Row label="Work" value={person.workTel} />
      {person.address && (
        <div className="pt-2">
          <div className="text-slate-500 text-xs mb-1">Address</div>
          <div className="text-slate-700 text-sm whitespace-pre-line leading-snug">{person.address}</div>
        </div>
      )}
    </div>
  );
}

function BiographyTab({
  birthPlace, occupation, company, interests, activities, bioNotes,
}: {
  birthPlace?: string;
  occupation?: string;
  company?: string;
  interests?: string;
  activities?: string;
  bioNotes?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Row label="Birth place" value={birthPlace} />
        <Row label="Profession" value={occupation} />
        <Row label="Company" value={company} />
      </div>
      {interests && (
        <Block label="Interests" body={interests} />
      )}
      {activities && (
        <Block label="Activities" body={activities} />
      )}
      {bioNotes && (
        <Block label="Bio notes" body={bioNotes} />
      )}
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{body}</div>
    </div>
  );
}

// ── utils ─────────────────────────────────────────────────────────────

function extractYear(date: string | undefined): string | null {
  if (!date) return null;
  const match = date.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

// Silence unused-import warning on IDB_PHOTO_PREFIX when tree-shaken
void IDB_PHOTO_PREFIX;
