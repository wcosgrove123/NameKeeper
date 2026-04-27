'use client';

import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GedcomUploader from '@/components/GedcomUploader';
import FamilyTree from '@/components/FamilyTree';
import NameKeeperPanel from '@/components/NameKeeperPanel';
import PersonSidePanel, { ConnectedFamily } from '@/components/PersonSidePanel';
import MatriarchView from '@/components/MatriarchView';
import AppHeader from '@/components/AppHeader';
import { getSurnames } from '@/lib/gedcom-parser';
import { computeAllNameKeepers, getSuccessionIds } from '@/lib/namekeeper';
import { computeNameKeeperStats, computeWhatIfSuccession } from '@/lib/namekeeper-stats';
import { computeAllMatriarchStats, MatriarchStats } from '@/lib/matriarch-stats';
import { buildPatrilinealTree, type CytoElement } from '@/lib/tree-layout';
import { NameKeeperResult, NameKeeperStats, Person, WhatIfResult } from '@/lib/types';
import { useFamilyTreeStore } from '@/lib/store';
import { useAuth } from '@/lib/auth-store';
import { useAutoLoad } from '@/lib/use-auto-load';

export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-slate-50"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin } = useAuth();
  const READ_ONLY = !isAdmin;
  const { data: gedcomData, isLoaded, loadFromGedcom } = useFamilyTreeStore();

  const [nameKeeperResults, setNameKeeperResults] = useState<Map<string, NameKeeperResult[]>>(
    new Map()
  );
  const [selectedSurname, setSelectedSurname] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [matriarchViewStats, setMatriarchViewStats] = useState<MatriarchStats | null>(null);
  // Mobile-only: surname list is a slide-in drawer because the desktop's fixed
  // 288px sidebar would steal more than half the canvas on a phone.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Auto-load from IndexedDB or bundled data (read-only mode)
  useAutoLoad();

  // Recompute namekeeper results when data changes
  useEffect(() => {
    if (!gedcomData) {
      setNameKeeperResults(new Map());
      setSelectedSurname(null);
      return;
    }

    const results = computeAllNameKeepers(gedcomData);
    setNameKeeperResults(results);

    // Honor cross-page deep link first: ?surname=Cosgrove&person=@I123@
    const linkSurname = searchParams.get('surname');
    const linkPerson = searchParams.get('person');
    if (linkSurname && results.has(linkSurname)) {
      setSelectedSurname(linkSurname);
      if (linkPerson) {
        const p = gedcomData.persons.get(linkPerson);
        if (p) setSelectedPerson(p);
      }
      return;
    }

    // Auto-select first surname with active Name Keeper
    const firstActive = Array.from(results.entries()).find(([, res]) =>
      res.some((r) => r.currentNameKeeper !== null)
    );
    const surnames = getSurnames(gedcomData);
    if (firstActive) {
      setSelectedSurname(firstActive[0]);
    } else if (surnames.length > 0) {
      setSelectedSurname(surnames[0].surname);
    }
  }, [gedcomData, searchParams]);

  const handleFileLoaded = useCallback((content: string, name: string) => {
    loadFromGedcom(content, name);
  }, [loadFromGedcom]);

  const selectedResult = useMemo(() => {
    if (!selectedSurname || !nameKeeperResults.has(selectedSurname)) return null;
    const results = nameKeeperResults.get(selectedSurname)!;
    return results[0] || null;
  }, [selectedSurname, nameKeeperResults]);

  const nameKeeperStatsMap = useMemo<Map<string, NameKeeperStats>>(() => {
    if (!gedcomData || !selectedResult) return new Map();
    const primeLineIds = getSuccessionIds(selectedResult);
    return computeNameKeeperStats(
      selectedResult.surname,
      selectedResult.patriarch.id,
      gedcomData,
      primeLineIds
    );
  }, [gedcomData, selectedResult]);

  const matriarchStatsMap = useMemo<Map<string, MatriarchStats>>(() => {
    if (!gedcomData || !selectedResult) return new Map();
    return computeAllMatriarchStats(gedcomData, selectedResult.surname);
  }, [gedcomData, selectedResult]);

  // Compute connected family surnames for the selected person
  // Note: selectedPerson from Cytoscape click is a shell object with empty familiesAsSpouse,
  // so we must look up the full person from gedcomData by ID.
  const connectedFamilies = useMemo<ConnectedFamily[]>(() => {
    if (!gedcomData || !selectedPerson) return [];
    const fullPerson = gedcomData.persons.get(selectedPerson.id);
    if (!fullPerson) return [];

    const families: ConnectedFamily[] = [];
    const seen = new Set<string>();

    // Birth family — father's surname
    if (fullPerson.familyAsChild) {
      const birthFam = gedcomData.families.get(fullPerson.familyAsChild);
      if (birthFam) {
        const fatherId = birthFam.husbandId;
        const motherId = birthFam.wifeId;
        if (fatherId) {
          const father = gedcomData.persons.get(fatherId);
          if (father && !seen.has(father.surname)) {
            seen.add(father.surname);
            families.push({ surname: father.surname, role: 'birth' });
          }
        }
        if (motherId) {
          const mother = gedcomData.persons.get(motherId);
          if (mother && mother.surname !== fullPerson.surname && !seen.has(mother.surname)) {
            seen.add(mother.surname);
            families.push({ surname: mother.surname, role: 'birth' });
          }
        }
      }
    }

    // Spouse families — the other spouse's surname
    for (const famId of fullPerson.familiesAsSpouse) {
      const fam = gedcomData.families.get(famId);
      if (!fam) continue;
      const spouseId = fam.husbandId === fullPerson.id ? fam.wifeId : fam.husbandId;
      if (spouseId) {
        const spouse = gedcomData.persons.get(spouseId);
        if (spouse && !seen.has(spouse.surname)) {
          seen.add(spouse.surname);
          families.push({ surname: spouse.surname, role: 'spouse' });
        }
      }
    }

    return families;
  }, [gedcomData, selectedPerson]);

  const treeData = useMemo(() => {
    if (!gedcomData || !selectedResult) return { elements: [] as CytoElement[], spousePairs: [] as Array<{ husbandId: string; wifeId: string }>, junctionIds: new Map<string, string>() };
    return buildPatrilinealTree(
      selectedResult.patriarch.id,
      gedcomData,
      selectedResult,
      nameKeeperStatsMap,
      whatIfResult
    );
  }, [gedcomData, selectedResult, nameKeeperStatsMap, whatIfResult]);

  const treeElements = treeData.elements;
  const spousePairs = treeData.spousePairs;
  const junctionIds = treeData.junctionIds;

  const handleNodeClick = useCallback((person: Person | null) => {
    setSelectedPerson(person);

    if (whatIfMode && person && gedcomData && selectedResult) {
      const primeLineIds = getSuccessionIds(selectedResult);
      if (primeLineIds.has(person.id)) {
        const result = computeWhatIfSuccession(
          person.id,
          gedcomData,
          selectedResult.surname,
          selectedResult.patriarch.id
        );
        setWhatIfResult(result);
      }
    } else if (!whatIfMode) {
      setWhatIfResult(null);
    }
  }, [whatIfMode, gedcomData, selectedResult]);

  const toggleWhatIfMode = useCallback(() => {
    setWhatIfMode(prev => {
      if (prev) setWhatIfResult(null);
      return !prev;
    });
  }, []);

  // Loading state while checking IndexedDB
  if (!isLoaded) {
    return (
      <div className="flex flex-col h-app bg-slate-100">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Upload screen (or loading screen in read-only mode)
  if (!gedcomData) {
    return (
      <div className="flex flex-col h-app bg-gradient-to-b from-slate-50 to-slate-100">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="max-w-2xl w-full">
            <div className="text-center mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-4xl font-bold text-slate-800 mb-2 sm:mb-3">
                Name Keeper
              </h1>
              <p className="text-sm sm:text-lg text-slate-500">
                {READ_ONLY ? 'Loading family data...' : 'Trace patrilineal surname succession through your family tree'}
              </p>
            </div>
            {READ_ONLY ? (
              <div className="flex justify-center">
                <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <GedcomUploader onFileLoaded={handleFileLoaded} />
                <div className="mt-6 text-center text-xs sm:text-sm text-slate-400">
                  Upload a GEDCOM (.ged) file exported from Family Echo, Gramps, webtrees, or any genealogy software.
                  All processing happens locally in your browser.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main app view
  return (
    <div className="flex flex-col h-app bg-slate-100">
      <AppHeader />
      <div className="flex flex-1 min-h-0 relative">
        {/* Left sidebar — fixed dock at md+, slide-in drawer on phones.
            On phones the surnames list would steal half the canvas, so it's
            hidden behind a floating toggle (the "Surnames" button below). */}
        <div className="hidden md:flex w-72 bg-white border-r border-slate-200 flex-col">
          <NameKeeperPanel
            results={nameKeeperResults}
            selectedSurname={selectedSurname}
            onSelectSurname={setSelectedSurname}
            selectedResult={selectedResult}
          />
        </div>

        {/* Mobile drawer — only mounted when open so the close transition
            doesn't fight any tree-canvas pointer events. */}
        {mobileSidebarOpen && (
          <>
            <button
              type="button"
              aria-label="Close surname list"
              className="md:hidden fixed inset-0 z-30 bg-black/30 animate-fade-slide-in"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="md:hidden fixed inset-y-0 left-0 z-40 w-[min(20rem,85vw)] bg-white border-r border-slate-200 flex flex-col shadow-2xl pt-safe pb-safe pl-safe">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 shrink-0">
                <span className="text-sm font-semibold text-slate-700">Surnames</span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="touch-target text-slate-400 hover:text-slate-700 -mr-2 px-2"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <NameKeeperPanel
                  results={nameKeeperResults}
                  selectedSurname={selectedSurname}
                  onSelectSurname={(s) => { setSelectedSurname(s); setMobileSidebarOpen(false); }}
                  selectedResult={selectedResult}
                />
              </div>
            </div>
          </>
        )}

        {/* Main area - Tree visualization */}
        <div className="flex-1 relative min-w-0">
          <FamilyTree
            elements={treeElements}
            spousePairs={spousePairs}
            junctionIds={junctionIds}
            patriarchId={selectedResult?.patriarch.id}
            patriarchSurname={selectedResult?.surname}
            successionIds={selectedResult ? getSuccessionIds(selectedResult) : undefined}
            onNodeClick={handleNodeClick}
            selectedSurname={selectedSurname || undefined}
            whatIfMode={whatIfMode}
            onToggleWhatIf={toggleWhatIfMode}
          />

          {/* Mobile-only floating "Surnames" trigger. The desktop sidebar is
              always visible at md+, so this button is hidden there. */}
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-md border border-slate-200 text-xs font-medium text-slate-700 active:bg-slate-50"
            aria-label="Open surname list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span className="truncate max-w-[8rem]">
              {selectedSurname ?? 'Surnames'}
            </span>
          </button>

          {/* Person detail popup — desktop: anchored top-right above the zoom
              toolbar. Mobile: bottom sheet that fills the lower 70% of the
              screen, with the safe-area-inset on its bottom padding so the
              home-indicator on notched iPhones doesn't cover the buttons. */}
          {selectedPerson && gedcomData && (
            <div className="absolute z-10 inset-x-2 bottom-2 max-h-[75svh] md:inset-x-auto md:top-3 md:right-3 md:bottom-[76px] md:w-[360px] md:max-h-[unset] pb-safe md:pb-0">
              <PersonSidePanel
                person={gedcomData.persons.get(selectedPerson.id) || selectedPerson}
                data={gedcomData}
                nameKeeperStats={nameKeeperStatsMap.get(selectedPerson.id) ?? null}
                matriarchStats={matriarchStatsMap.get(selectedPerson.id) ?? null}
                connectedFamilies={connectedFamilies}
                whatIfResult={whatIfMode && whatIfResult && whatIfResult.eliminatedPerson.id === selectedPerson.id ? whatIfResult : null}
                onClose={() => setSelectedPerson(null)}
                onViewMatriarch={() => {
                  const stats = matriarchStatsMap.get(selectedPerson.id);
                  if (stats) setMatriarchViewStats(stats);
                }}
                onPhotoChange={(id, url) => useFamilyTreeStore.getState().updatePerson(id, { photoUrl: url })}
                onOpenInTreeView={(id) => router.push(`/tree-view-2?person=${encodeURIComponent(id)}`)}
              />
            </div>
          )}

          {/* Matriarch View panel */}
          {matriarchViewStats && (
            <MatriarchView
              stats={matriarchViewStats}
              onClose={() => setMatriarchViewStats(null)}
            />
          )}

          {/* Top bar showing current Name Keeper. On phones it's anchored to
              the right of the floating "Surnames" button so they don't
              collide; on desktop it stays centered. */}
          {selectedResult?.currentNameKeeper && (
            <div className="absolute top-3 right-3 md:left-1/2 md:right-auto md:-translate-x-1/2 max-w-[calc(100vw-9rem)] md:max-w-none bg-white/90 backdrop-blur-sm rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 shadow-md border border-amber-200 animate-fade-slide-in z-10">
              <div className="text-[10px] sm:text-xs text-slate-500 text-center truncate">
                Current {selectedResult.surname} Name Keeper
              </div>
              <div className="text-xs sm:text-sm font-bold text-amber-800 text-center truncate">
                {selectedResult.currentNameKeeper.givenName}{' '}
                {selectedResult.currentNameKeeper.surname}
              </div>
            </div>
          )}

          {selectedResult && !selectedResult.currentNameKeeper && (
            <div className="absolute top-3 right-3 md:left-1/2 md:right-auto md:-translate-x-1/2 max-w-[calc(100vw-9rem)] md:max-w-none bg-white/90 backdrop-blur-sm rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 shadow-md border border-slate-200 animate-fade-slide-in z-10">
              <div className="text-[10px] sm:text-xs text-slate-500 text-center truncate">
                {selectedResult.surname} Line
              </div>
              <div className="text-xs sm:text-sm font-semibold text-slate-400 text-center truncate">
                Extinct - No Living Male Heirs
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
