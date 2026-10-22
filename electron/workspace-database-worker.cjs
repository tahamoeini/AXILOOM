const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

const REQUIRED_TABLES = ['settings', 'jira_issues', 'jira_sprints', 'import_runs', 'product_records', 'record_events'];

function validateWorkspace(filePath, removeCredentials = false) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA busy_timeout=10000;');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    if (REQUIRED_TABLES.some((table) => !tables.has(table))) throw new Error('این فایل، پشتیبان کامل Axiloom نیست.');
    if (removeCredentials) db.prepare("DELETE FROM settings WHERE key='jira_pat_encrypted'").run();
    const status = db.prepare('PRAGMA integrity_check').get();
    if (status?.integrity_check !== 'ok') throw new Error('پایگاه دادهٔ انتخاب‌شده سالم نیست.');
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
