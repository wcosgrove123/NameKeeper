// Site-wide configuration for hosted mode
// Set these via environment variables at build time:
//   NEXT_PUBLIC_SITE_PASSWORD_HASH  — SHA-256 hex hash of the password
//   NEXT_PUBLIC_READ_ONLY           — "true" to disable all editing

export const SITE_PASSWORD_HASH = process.env.NEXT_PUBLIC_SITE_PASSWORD_HASH || '';
export const READ_ONLY = process.env.NEXT_PUBLIC_READ_ONLY === 'true';

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
