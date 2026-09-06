import {
  ensureStorageCapacity,
  formatBytes,
  purgeOldSessions,
  STORAGE_QUOTA_BYTES,
  UPLOADS_ROOT,
} from '../lib/files.ts';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

try {
  const purgedSessions = await purgeOldSessions(SESSION_MAX_AGE_MS);
  const quota = await ensureStorageCapacity();
  console.log(
    `${new Date().toISOString()} age_purged=${purgedSessions} quota_purged=${quota.purgedSessions}` +
    ` stored=${formatBytes(quota.storedBytes)} quota=${formatBytes(STORAGE_QUOTA_BYTES)} root=${UPLOADS_ROOT}`
  );
} catch (error) {
  console.error(`${new Date().toISOString()} cleanup_failed`, error);
  process.exitCode = 1;
}
