import { GedcomData, Person } from './types';

/**
 * Score how well a search query matches a person.
 *
 * Rules (designed so middle names and maiden names don't trip up multi-word
 * queries like "wil cosgrove"):
 *   - Query is split on whitespace into tokens; EVERY token must match
 *   - Each token can hit any one of these haystacks:
 *       given name parts, current surname, surname at birth, nickname
 *   - Strongest hit per token wins:
 *       exact word ........ +200
 *       word prefix ....... +120
 *       substring ......... +60
 *       char-in-order ..... +20 (fuzzy fallback)
 *   - Bonus +250 if the full "given surname" starts with the raw query
 *   - Bonus +150 if a 4-digit token matches the person's birth year
 *
 * Returns 0 if any token failed to match.
 */
export function scorePersonMatch(query: string, person: Person): number {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 0;

  const tokens = trimmed.split(/\s+/).filter(Boolean);

  // Build word-level haystacks
  const haystacks: string[] = [];
  if (person.givenName) haystacks.push(...person.givenName.toLowerCase().split(/\s+/));
  if (person.surname) haystacks.push(person.surname.toLowerCase());
  if (person.surnameAtBirth && person.surnameAtBirth !== person.surname) {
    haystacks.push(person.surnameAtBirth.toLowerCase());
  }
  if (person.nickname) haystacks.push(person.nickname.toLowerCase());
  if (haystacks.length === 0) return 0;

  let total = 0;
  const birthYear = person.birthDate?.match(/\b(\d{4})\b/)?.[1];

  for (const token of tokens) {
    let best = 0;
    if (birthYear && token === birthYear) {
      best = 150;
    } else {
      for (const word of haystacks) {
        if (word === token) { best = Math.max(best, 200); continue; }
        if (word.startsWith(token)) { best = Math.max(best, 120); continue; }
        if (word.includes(token)) { best = Math.max(best, 60); continue; }
        if (charInOrder(token, word)) { best = Math.max(best, 20); continue; }
      }
    }
    if (best === 0) return 0; // hard fail — every token must hit
    total += best;
  }

  // Full-name prefix bonus
  const full = `${person.givenName} ${person.surname}`.toLowerCase();
  if (full.startsWith(trimmed)) total += 250;

  return total;
}

function charInOrder(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

export function searchPersons(data: GedcomData, query: string, limit = 30): Person[] {
  if (!query.trim()) return [];
  const scored: { person: Person; score: number }[] = [];
  for (const person of data.persons.values()) {
    const score = scorePersonMatch(query, person);
    if (score > 0) scored.push({ person, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.person.surname.localeCompare(b.person.surname);
  });
  return scored.slice(0, limit).map((s) => s.person);
}
