#!/usr/bin/env node
// Generate a SHA-256 hash for a password to use as SITE_PASSWORD_HASH
// Usage: node scripts/hash-password.mjs "your-password"

import { createHash } from 'crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "your-password"');
  process.exit(1);
}

const hash = createHash('sha256').update(password).digest('hex');
console.log(`\nPassword: ${password}`);
console.log(`SHA-256:  ${hash}`);
console.log(`\nSet this as your GitHub secret SITE_PASSWORD_HASH`);
