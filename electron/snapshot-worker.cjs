const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase, getDataGeneration, getMetricsGeneration, saveCachedReport, saveBusinessIssueCache, saveCachedMetrics } = require('./database.cjs');
const { buildSnapshot } = require('./snapshot.cjs');

const db = openDatabase(workerData.dbPath);
let snapshot;
const cacheMetadata = {};
try {
  db.exec('BEGIN');
  snapshot = buildSnapshot(db, workerData.filters || {}, { persist: false, cacheMetadata });
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
  throw error;
} finally {
  if (cacheMetadata.value) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = cacheMetadata.value;
      if (value.metricsToCache && getMetricsGeneration(db) === value.metricsGeneration) {
        saveCachedMetrics(db, value.metricsGeneration, value.snapshotDate, value.engineHash, value.configHash, value.metricsToCache);
      }
      if (getDataGeneration(db) === value.dataGeneration) {
        const { cacheKey, dataGeneration, engineHash, configHash, snapshotDate, businessIssues } = value;
        saveCachedReport(db, cacheKey, dataGeneration, engineHash, configHash, snapshot);
        saveBusinessIssueCache(db, dataGeneration, snapshotDate, businessIssues);
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* The write transaction may already have closed. */ }
      throw error;
    }
  }
  db.close();
}
parentPort.postMessage({ type: 'snapshot', value: snapshot });
