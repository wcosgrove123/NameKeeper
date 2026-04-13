export interface Person {
  id: string;
  givenName: string;
  surname: string;
  marriedName?: string;
  nickname?: string;
  sex: 'M' | 'F' | 'U';
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  isLiving: boolean;
  occupation?: string;
  familiesAsSpouse: string[];
  familyAsChild?: string;
  notes: string[];
}

export interface Family {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childIds: string[];
  marriageDate?: string;
  marriagePlace?: string;
  isCurrent?: boolean;
}

export interface GedcomData {
  persons: Map<string, Person>;
  families: Map<string, Family>;
}

export interface Branch {
  /** The person where this branch diverges from the main line */
  ancestor: Person;
  /** 'active' = has living male descendants, 'extinct' = no living male descendants */
  status: 'active' | 'extinct';
  /** Last person in this branch (if extinct or terminal) */
  terminalPerson?: Person;
  /** Generation depth from patriarch */
  depth: number;
  /** All persons in this branch's patrilineal line */
  members: Person[];
}

export interface NameKeeperStats {
  /** How many unbroken eldest-son generations upward from this person (min 1) */
  nameKeeperGeneration: number;
  /** Number of non-eldest-son hops from patriarch to this person (0 = on prime line) */
  removalFromPrime: number;
  /** Whether this person is on the prime (golden) succession line */
  isOnPrimeLine: boolean;
}

export interface WhatIfResult {
  /** The person on the prime line whose line was hypothetically eliminated */
  eliminatedPerson: Person;
  /** The new namekeeper under the what-if scenario */
  newNameKeeper: Person | null;
  /** The alternate succession path from the divergence point to the new namekeeper */
  alternateSuccessionChain: Person[];
  /** The person where the alternate line diverges from the original prime line */
  divergencePoint: Person;
}

export interface NameKeeperResult {
  surname: string;
  /** Root ancestor — oldest male with this surname who has no father with the same surname */
  patriarch: Person;
  /** The living eldest-son-line heir, or null if the entire line is extinct */
  currentNameKeeper: Person | null;
  /** Full path from patriarch to current Name Keeper */
  successionChain: Person[];
  /** All branches from the patriarch */
  branches: Branch[];
  /** Total male descendants with this surname */
  totalMales: number;
  /** Total living males with this surname */
  livingMales: number;
}
