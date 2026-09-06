import { purgeOldSessions, UPLOADS_ROOT } from '../lib/files.ts';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

try {
  const purgedSessions = await purgeOldSessions(SESSION_MAX_AGE_MS);
  console.log(`${new Date().toISOString()} purged=${purgedSessions} root=${UPLOADS_ROOT}`);
} catch (error) {
  console.error(`${new Date().toISOString()} cleanup_failed`, error);
  process.exitCode = 1;
}
