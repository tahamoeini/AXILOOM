const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('./database.cjs');
const LIMITS = require('../shared/resource-limits.json').workspace;

const REQUIRED_TABLES = ['settings', 'jira_issues', 'jira_sprints', 'import_runs', 'product_records', 'record_events'];
const REQUIRED_CORE_TABLES = ['settings', 'jira_issues', 'import_runs'];

function validateWorkspace(filePath, removeCredentials = false) {
  const headerDb = new DatabaseSync(filePath, { readOnly: true });
  let userVersion = 0;
  let configVersion = 0;
  let hasCoreSchema = false;
  try {
    userVersion = Number(headerDb.prepare('PRAGMA user_version').get().user_version || 0);
    const tables = new Set(headerDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    hasCoreSchema = REQUIRED_CORE_TABLES.every((table) => tables.has(table));
    const settingsTable = tables.has('settings');
    if (settingsTable) {
      const row = headerDb.prepare("SELECT value_json FROM settings WHERE key='config'").get();
      try { configVersion = Number(JSON.parse(row?.value_json || '{}').schemaVersion || 0); }
      catch { throw new Error('The selected workspace configuration is not valid JSON.'); }
    }
  } finally { headerDb.close(); }
  if (!Number.isSafeInteger(userVersion) || userVersion < 0) throw new Error('Workspace database version is invalid.');
  if (!hasCoreSchema) throw new Error('The selected file does not contain an Axiloom workspace schema.');
  if (!Number.isSafeInteger(configVersion) || configVersion < 0) throw new Error('Workspace configuration schema version is invalid.');
  if (userVersion > LIMITS.maxUserVersion) throw new Error(`The selected workspace uses a newer database schema (${userVersion}) than this Axiloom build supports.`);
  if (configVersion > LIMITS.maxConfigSchemaVersion) throw new Error(`The selected workspace uses a newer configuration schema (${configVersion}) than this Axiloom build supports.`);
  const db = openDatabase(filePath);
  try {
    db.exec('PRAGMA busy_timeout=10000;');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    if (REQUIRED_TABLES.some((table) => !tables.has(table))) throw new Error('این فایل، پشتیبان کامل Axiloom نیست.');
    if (removeCredentials) db.prepare("DELETE FROM settings WHERE key='jira_pat_encrypted'").run();
    const status = db.prepare('PRAGMA integrity_check').get();
    if (status?.integrity_check !== 'ok') throw new Error('پایگاه دادهٔ انتخاب‌شده سالم نیست.');
    const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
    if (version !== LIMITS.maxUserVersion) throw new Error(`Workspace schema migration did not reach the supported version ${LIMITS.maxUserVersion}.`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally { db.close(); }
}

let source;
try {
  if (workerData.mode === 'backup') {
    source = new DatabaseSync(workerData.dbPath);
    source.exec('PRAGMA busy_timeout=10000;');
    const escapedPath = String(workerData.targetPath).replace(/'/g, "''");
    source.exec(`VACUUM INTO '${escapedPath}'`);
    source.close();
    source = null;
    validateWorkspace(workerData.targetPath, true);
  } else if (workerData.mode === 'restore-snapshot') {
    source = new DatabaseSync(workerData.sourcePath, { readOnly: true });
    source.exec('PRAGMA busy_timeout=10000;');
    const escapedPath = String(workerData.targetPath).replace(/'/g, "''");
    source.exec(`VACUUM INTO '${escapedPath}'`);
    source.close();
    source = null;
  } else if (workerData.mode === 'validate') {
    validateWorkspace(workerData.dbPath, true);
  } else {
    throw new Error('نوع عملیات فضای کاری معتبر نیست.');
  }
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  if (source) source.close();
}
