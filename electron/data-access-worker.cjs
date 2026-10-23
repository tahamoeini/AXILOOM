const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const {
  getIssueDetails, getIssueActivity, getSprintDetails, listIssues, getEpicReport, listRecords,
  getIssueFilterOptions, getIssueOverviewStats, getCalendarPeriodReport, getBusinessBoardReport,
} = require('./database.cjs');
const { listBusinessSprints, getBusinessSprintReport } = require('./business-sprint.cjs');
const { buildSnapshot } = require('./snapshot.cjs');

const readers = {
  getIssueDetails,
  getIssueActivity,
  getSprintDetails,
  listIssues,
  getEpicReport,
  listRecords,
  getRecordLinkSummaries: (database, ids) => {
    const recordIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 250);
    return recordIds.length ? buildSnapshot(database, { recordIds }, { persist: false }).links : [];
  },
  getIssueFilterOptions,
  getIssueOverviewStats,
  getCalendarPeriodReport,
  getBusinessBoardReport,
  listBusinessSprints,
  getBusinessSprintReport,
};

let db;
try {
  if (!Object.hasOwn(readers, workerData.method)) throw new Error('درخواست خواندن داده مجاز نیست.');
  db = new DatabaseSync(workerData.dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA query_only=ON;');
  const value = readers[workerData.method](db, ...(Array.isArray(workerData.args) ? workerData.args : []));
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  if (db) db.close();
}
