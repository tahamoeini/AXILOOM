const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const {
  getIssueDetails, getIssueActivity, getSprintDetails, listIssues,
  getIssueFilterOptions, getIssueOverviewStats, getCalendarPeriodReport, getBusinessBoardReport,
} = require('./database.cjs');
const { listBusinessSprints, getBusinessSprintReport } = require('./business-sprint.cjs');

const readers = {
  getIssueDetails,
  getIssueActivity,
  getSprintDetails,
  listIssues,
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
