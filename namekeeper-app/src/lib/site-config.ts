// Site-wide configuration for hosted mode.

export const SITE_PASSWORD_HASH = process.env.NEXT_PUBLIC_SITE_PASSWORD_HASH || '';

/**
 * The hardcoded environment flag is kept for backwards compatibility but
 * should no longer be used to gate editing UI. Use the `useIsAdmin()` hook
 * from `src/lib/auth-store.ts` instead — editing now opens up when the
 * signed-in Firebase user matches ADMIN_UID.
 *
 * @deprecated prefer useIsAdmin()
 */
export const READ_ONLY = process.env.NEXT_PUBLIC_READ_ONLY === 'true';

/**
 * Firebase UID of the master editor. Only this user can push mutations to
 * the shared Firestore `family_state/current` document. Everyone else sees
 * the live snapshot read-only.
 */
export const ADMIN_UID = 'qwws4bq0hafgbGhzFg5TQMbInQD3';

/**
 * Hash a password string with SHA-256 and return hex.
 * Used client-side to compare against SITE_PASSWORD_HASH.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
