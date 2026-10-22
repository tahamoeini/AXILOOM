const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, getConfig, saveConfig, saveIssue, saveSprint, saveLocalIssueLink, removeLocalIssueLink, saveRecordRelationship, listRecordRelationships, archiveRecordRelationship, getIssueDetails, getIssueActivity, getSprintDetails, listIssues, getIssueFilterOptions, getIssueOverviewStats, getCalendarPeriodReport, getBusinessBoardReport } = require('./database.cjs');
const { sourceIdentityKey } = require('./configuration.cjs');
const { createOfflineAdapter, createProviderAdapter, describeProvider, parseJiraBaseUrl } = require('./jira-providers.cjs');
const { writeWorkbook } = require('./xlsx.cjs');
const { attachReportContext } = require('./reporting.cjs');
const workspaceRegistry = require('./workspaces.cjs');

let db;
let mainWindow;
let activeImportRun = null;
let syncWorker = null;
const snapshotWorkers = new Set();
const dataAccessWorkers = new Set();
const dataAccessQueue = [];
let activeDataAccessWorkers = 0;
const MAX_DATA_ACCESS_WORKERS = 4;
const MAX_QUEUED_DATA_ACCESS_REQUESTS = 32;
const workspaceBackupWorkers = new Set();
let workspaceBackupInProgress = false;
let workspaceMaintenance = false;
let snapshotGeneration = 0;
let snapshotCache = null;
let snapshotWorkerQueue = Promise.resolve();
const snapshotFlights = new Map();
let sessionPat = '';
let workspaceDirectory = '';
let workspaceRoot = '';
let workspaceIndex = null;
let activeWorkspace = null;
let workspaceWarning = '';
let databaseFile = '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f5f7fa',
    title: 'Axiloom',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"]
    } });
  });
  mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function getWorkspacePath() {
  if (workspaceRoot) return workspaceRoot;
  if (process.platform === 'darwin') {
    const macWorkspace = path.join(app.getPath('appData'), 'Axiloom', 'workspace');
    fs.mkdirSync(macWorkspace, { recursive: true });
    fs.accessSync(macWorkspace, fs.constants.W_OK);
    workspaceRoot = macWorkspace;
    app.setPath('userData', workspaceRoot);
    return workspaceRoot;
  }
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const portableWorkspace = path.join(portableRoot, 'workspace');
  const networkLaunchPath = process.platform === 'win32' && /^\\\\/.test(portableRoot);
  try {
    if (networkLaunchPath) throw new Error('SQLite workspaces cannot be used directly from a network share.');
    fs.mkdirSync(portableWorkspace, { recursive: true });
    fs.accessSync(portableWorkspace, fs.constants.W_OK);
    workspaceRoot = portableWorkspace;
  } catch {
    const fallbackRoot = process.platform === 'win32' && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : app.getPath('appData');
    const fallback = path.join(fallbackRoot, 'Axiloom', 'workspace');
    fs.mkdirSync(fallback, { recursive: true });
    workspaceRoot = fallback;
    if (networkLaunchPath) workspaceWarning = 'Axiloom was launched from a Windows network path, so it uses this computer’s local workspace. Do not share the SQLite database file between computers.';
  }
  app.setPath('userData', workspaceRoot);
  return workspaceRoot;
}

function workspaceOperationsBusy() {
  return Boolean(activeImportRun || syncWorker || workspaceBackupInProgress || workspaceMaintenance
    || workspaceBackupWorkers.size || snapshotWorkers.size || snapshotFlights.size || dataAccessWorkers.size || dataAccessQueue.length);
}

function openActiveWorkspace(info, registry) {
  const nextDb = openDatabase(info.databaseFile);
  const nextConfig = getConfig(nextDb);
  if (nextConfig.workspaceName !== info.name) saveConfig(nextDb, { ...nextConfig, workspaceName: info.name }, 'workspace-name-synchronized');
  const oldDb = db;
  if (oldDb) {
    try { oldDb.exec('PRAGMA wal_checkpoint(TRUNCATE)'); oldDb.close(); }
    catch (error) { nextDb.close(); throw error; }
  }
  try { workspaceRegistry.saveRegistry(workspaceRoot, registry); }
  catch (error) {
    nextDb.close();
    if (oldDb) db = openDatabase(databaseFile);
    throw error;
  }
  db = nextDb;
  activeWorkspace = info;
  workspaceDirectory = info.directory;
  databaseFile = info.databaseFile;
  workspaceIndex = registry;
  sessionPat = '';
  invalidateSnapshot();
  return { id: info.id, name: info.name, path: info.directory };
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function invalidateSnapshot() {
  snapshotGeneration += 1;
  snapshotCache = null;
}

function runSnapshotWorker(filters = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'snapshot-worker.cjs'), { workerData: { dbPath: databaseFile, filters } });
    let result;
    let messageError = null;
    let receivedMessage = false;
    snapshotWorkers.add(worker);
    worker.once('message', (message) => {
      receivedMessage = true;
      if (message.type === 'snapshot') result = message.value;
      else messageError = new Error(message.error || 'محاسبهٔ گزارش کامل نشد.');
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      snapshotWorkers.delete(worker);
      if (code !== 0) reject(new Error(`پردازهٔ گزارش با کد ${code} متوقف شد.`));
      else if (messageError) reject(messageError);
      else if (!receivedMessage) reject(new Error('پردازهٔ گزارش بدون پاسخ کامل شد.'));
      else resolve(result);
    });
  });
}

function runDataAccessRequest(method, args = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'data-access-worker.cjs'), {
      workerData: { dbPath: databaseFile, method, args },
    });
    dataAccessWorkers.add(worker);
    let response = null;
    let workerError = null;
    worker.once('message', (message) => { response = message; });
    worker.once('error', (error) => { workerError = error; });
    worker.once('exit', (code) => {
      dataAccessWorkers.delete(worker);
      if (workerError) reject(workerError);
      else if (code !== 0) reject(new Error(`پردازهٔ خواندن داده با کد ${code} متوقف شد.`));
      else if (!response) reject(new Error('پردازهٔ خواندن داده بدون پاسخ کامل شد.'));
      else if (response.ok) resolve(response.value);
      else reject(new Error(response.error || 'خواندن اطلاعات کامل نشد.'));
    });
  });
}

function pumpDataAccessQueue() {
  while (!workspaceMaintenance && activeDataAccessWorkers < MAX_DATA_ACCESS_WORKERS && dataAccessQueue.length) {
    const request = dataAccessQueue.shift();
    activeDataAccessWorkers += 1;
    runDataAccessRequest(request.method, request.args)
      .then(request.resolve, request.reject)
      .finally(() => {
        activeDataAccessWorkers -= 1;
        pumpDataAccessQueue();
      });
  }
}

function runDataAccessWorker(method, args = []) {
  if (workspaceMaintenance) return Promise.reject(new Error('فضای کاری در حال تعویض است؛ پس از راه‌اندازی دوباره تلاش کنید.'));
  if (dataAccessQueue.length >= MAX_QUEUED_DATA_ACCESS_REQUESTS) return Promise.reject(new Error('تعداد درخواست‌های خواندن زیاد است؛ کمی صبر کنید و دوباره تلاش کنید.'));
  return new Promise((resolve, reject) => {
    dataAccessQueue.push({ method, args, resolve, reject });
    pumpDataAccessQueue();
  });
}

function runWorkspaceDatabaseWorker(mode, filePath) {
  if (workspaceMaintenance) return Promise.reject(new Error('فضای کاری در حال تعویض است؛ پس از راه‌اندازی دوباره تلاش کنید.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'workspace-database-worker.cjs'), {
      workerData: { mode, dbPath: mode === 'backup' ? databaseFile : filePath, targetPath: filePath },
    });
    workspaceBackupWorkers.add(worker);
    let response = null;
    let workerError = null;
    worker.once('message', (message) => { response = message; });
    worker.once('error', (error) => { workerError = error; });
    worker.once('exit', (code) => {
      workspaceBackupWorkers.delete(worker);
      if (workerError) reject(workerError);
      else if (code !== 0) reject(new Error(`پردازهٔ فضای کاری با کد ${code} متوقف شد.`));
      else if (!response) reject(new Error('پردازهٔ فضای کاری بدون پاسخ کامل شد.'));
      else if (response.ok) resolve(response.value || { ok: true });
      else reject(new Error(response.error || 'عملیات فضای کاری کامل نشد.'));
    });
  });
}

function readSnapshotInWorker(filters = {}) {
  if (workspaceMaintenance) return Promise.reject(new Error('فضای کاری در حال تعویض است؛ پس از راه‌اندازی دوباره تلاش کنید.'));
  const cleanFilters = filters && typeof filters === 'object' ? filters : {};
  const filterKey = JSON.stringify(cleanFilters);
  const generation = snapshotGeneration;
  if (snapshotCache?.generation === generation && snapshotCache.filterKey === filterKey) return Promise.resolve(snapshotCache.value);
  const flightKey = `${generation}:${filterKey}`;
  if (snapshotFlights.has(flightKey)) return snapshotFlights.get(flightKey);

  const workerJob = snapshotWorkerQueue.then(() => generation === snapshotGeneration ? runSnapshotWorker(cleanFilters) : null);
  snapshotWorkerQueue = workerJob.then(() => undefined, () => undefined);
  const result = workerJob.then((value) => {
    if (generation !== snapshotGeneration || !value) return readSnapshotInWorker(cleanFilters);
    snapshotCache = { generation, filterKey, value };
    return value;
  }).finally(() => snapshotFlights.delete(flightKey));
  snapshotFlights.set(flightKey, result);
  return result;
}

function safeRecord(input, config) {
  const template = (config.recordTemplates || []).find((item) => item.kind === input?.kind && item.enabled);
  if (!template) throw new Error('نوع ثبت در قالب‌های فعال این فضای کاری تعریف نشده است.');
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const title = String(input.title || payload.title || payload.action || payload.summary || payload.decision || payload.hypothesis || payload.name || '').trim();
  if (!title) throw new Error('عنوان را وارد کنید.');
  for (const field of template.fields) {
    const value = payload[field.key];
    const present = Array.isArray(value) ? value.length > 0 : typeof value === 'boolean' ? true : String(value ?? '').trim() !== '';
    if (field.required && !present) throw new Error(`فیلد «${field.label}» ضروری است.`);
    if (!present) continue;
    if (field.type === 'enum' && !field.options.includes(String(value))) throw new Error(`مقدار «${field.label}» در قالب فعال تعریف نشده است.`);
    if (field.type === 'number' && !Number.isFinite(Number(value))) throw new Error(`فیلد «${field.label}» باید عدد معتبر باشد.`);
    if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`فیلد «${field.label}» باید بله یا خیر باشد.`);
    if (['text', 'textarea', 'date', 'recordRef', 'issueRef'].includes(field.type) && typeof value !== 'string') throw new Error(`فیلد «${field.label}» باید متن معتبر باشد.`);
    if (field.type === 'date' && !Number.isFinite(Date.parse(value))) throw new Error(`فیلد «${field.label}» باید تاریخ معتبر باشد.`);
    if (field.type === 'issueRef' && !/^[A-Z][A-Z0-9_]*-\d+$/.test(value)) throw new Error(`فیلد «${field.label}» باید کلید Jira معتبر داشته باشد.`);
    if (field.type === 'issueRefList' && (!Array.isArray(value) || value.length > 500 || value.some((key) => typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*-\d+$/.test(key)))) {
      throw new Error(`فیلد «${field.label}» باید فهرستی از کلیدهای Jira معتبر داشته باشد.`);
    }
    if (typeof value === 'string' && value.length > (field.type === 'textarea' ? 10000 : 2000)) throw new Error(`فیلد «${field.label}» بیش از حد طولانی است.`);
  }
  return { kind: input.kind, title: title.slice(0, 500), payload };
}

function createRecordEvent(recordId, eventType, payload) {
  db.prepare('INSERT INTO record_events(record_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?)')
    .run(recordId, eventType, new Date().toISOString(), JSON.stringify(payload));
}

function jiraBaseUrl() {
  return parseJiraBaseUrl(getConfig(db).jiraUrl);
}

function jiraFetch(resourcePath, options = {}, token = sessionPat) {
  return createProviderAdapter(getConfig(db), token).request(resourcePath, options);
}

function savedPat() {
  if (sessionPat) return sessionPat;
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get('jira_pat_encrypted');
  if (!row || !safeStorage.isEncryptionAvailable()) return '';
  try { sessionPat = safeStorage.decryptString(Buffer.from(JSON.parse(row.value_json), 'base64')); }
  catch { return ''; }
  return sessionPat;
}

function rememberPat(token, save) {
  const clean = String(token || '').trim();
  if (!clean) throw new Error('PAT خالی است.');
  sessionPat = clean;
  if (save) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('رمزگذاری امن سیستم‌عامل در دسترس نیست؛ PAT فقط تا پایان این نشست در حافظه می‌ماند.');
    const encrypted = safeStorage.encryptString(clean).toString('base64');
    db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
      .run('jira_pat_encrypted', JSON.stringify(encrypted), new Date().toISOString());
  } else db.prepare('DELETE FROM settings WHERE key=?').run('jira_pat_encrypted');
  return { connected: true, saved: Boolean(save) };
}

function forgetPat() {
  sessionPat = '';
  db.prepare('DELETE FROM settings WHERE key=?').run('jira_pat_encrypted');
  return { connected: false, saved: false };
}

function registerHandlers() {
  require('./jira-management.cjs').registerJiraManagement({ ipcMain, db, jiraFetch, savedPat, saveIssue, getIssueDetails, invalidateSnapshot });
  ipcMain.handle('app:get-config', () => ({ ...getConfig(db), hasSavedPat: Boolean(db.prepare('SELECT 1 FROM settings WHERE key=?').get('jira_pat_encrypted')) }));
  ipcMain.handle('workspace:info', () => ({ id: activeWorkspace.id, name: activeWorkspace.name, path: databaseFile, warning: workspaceWarning, workspaces: workspaceRegistry.describeRegistry(workspaceRoot, workspaceIndex) }));
  ipcMain.handle('workspace:create', (_event, requestedName) => {
    if (workspaceOperationsBusy()) throw new Error('Wait for current imports, synchronization, reports, and backups to finish before creating a workspace.');
    const created = workspaceRegistry.addWorkspace(workspaceRoot, workspaceIndex, requestedName);
    let initialized;
    try {
      initialized = openDatabase(created.workspace.databaseFile);
      saveConfig(initialized, { ...getConfig(initialized), workspaceName: created.workspace.name }, 'workspace-created');
      initialized.close();
      const activated = openActiveWorkspace(created.workspace, created.registry);
      return { ...activated, workspaces: workspaceRegistry.describeRegistry(workspaceRoot, workspaceIndex) };
    } catch (error) {
      try { initialized?.close(); } catch { /* best effort */ }
      throw error;
    }
  });
  ipcMain.handle('workspace:activate', (_event, id) => {
    if (workspaceOperationsBusy()) throw new Error('Wait for current imports, synchronization, reports, and backups to finish before switching workspaces.');
    const nextRegistry = workspaceRegistry.activateWorkspace(workspaceRoot, workspaceIndex, String(id || ''));
    const nextInfo = workspaceRegistry.activeWorkspace(workspaceRoot, nextRegistry);
    if (!fs.existsSync(nextInfo.databaseFile)) throw new Error('The selected workspace database is missing; recover it from a backup before opening it.');
    return { ...openActiveWorkspace(nextInfo, nextRegistry), workspaces: workspaceRegistry.describeRegistry(workspaceRoot, workspaceIndex) };
  });
  ipcMain.handle('app:save-config', (_event, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be an object.');
    const previousConfig = getConfig(db);
    const config = { ...previousConfig, ...value };
    delete config.hasSavedPat;
    const endpointChanged = String(config.jiraUrl || '').trim() !== String(previousConfig.jiraUrl || '').trim();
    const issueCount = Number(db.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count);
    if (endpointChanged && issueCount > 0) throw new Error('This workspace already contains Jira evidence. Create a separate workspace to connect another Jira instance; raw history stays attached to this source.');
    if (endpointChanged && config.jiraUrl) {
      const endpoint = new URL(String(config.jiraUrl).trim());
      config.sourceInstance = { id: randomUUID(), provider: 'jira-datacenter', displayName: endpoint.hostname, endpoint: endpoint.toString().replace(/\/$/, '') };
    } else if (endpointChanged) {
      config.sourceInstance = { id: '', provider: 'offline-json', displayName: '', endpoint: '' };
    }
    const sourceChanged = sourceIdentityKey(previousConfig) !== sourceIdentityKey(config);
    if (sourceChanged && (activeImportRun || syncWorker)) throw new Error('Wait for the current import or Jira synchronization to finish before changing the workspace source.');
    const beforeRevision = previousConfig.configurationRevision;
    const saved = saveConfig(db, config);
    if (sourceChanged) sessionPat = '';
    if (saved.configurationRevision !== beforeRevision) invalidateSnapshot();
    return { ...saved, hasSavedPat: Boolean(db.prepare('SELECT 1 FROM settings WHERE key=?').get('jira_pat_encrypted')) };
  });
  ipcMain.handle('app:validate-config', (_event, value) => {
    const { validateConfig } = require('./configuration.cjs');
    return validateConfig(value);
  });
  ipcMain.handle('app:config-history', () => db.prepare('SELECT revision,schema_version AS schemaVersion,fingerprint,event_type AS eventType,created_at AS createdAt FROM configuration_revisions ORDER BY revision DESC LIMIT 100').all());
  ipcMain.handle('app:import-config-profile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import configuration profile', properties: ['openFile'], filters: [{ name: 'JSON profile', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const stats = await fs.promises.stat(result.filePaths[0]);
    if (stats.size > 2 * 1024 * 1024) throw new Error('Configuration profile exceeds the 2 MB limit.');
    const raw = await fs.promises.readFile(result.filePaths[0], 'utf8');
    const { validateConfig } = require('./configuration.cjs');
    const profile = validateConfig(JSON.parse(raw));
    return { canceled: false, profile, dryRun: true };
  });
  ipcMain.handle('app:export-config-profile', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Export configuration profile', defaultPath: 'axiloom-profile.json', filters: [{ name: 'JSON profile', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const profile = getConfig(db);
    delete profile.hasSavedPat;
    await fs.promises.writeFile(result.filePath, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' });
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('app:snapshot', (_event, filters) => readSnapshotInWorker(filters));
  ipcMain.handle('issues:list', (_event, filters) => runDataAccessWorker('listIssues', [filters || {}]));
  ipcMain.handle('records:list', (_event, filters) => runDataAccessWorker('listRecords', [filters || {}]));
  ipcMain.handle('records:link-summaries', (_event, ids) => runDataAccessWorker('getRecordLinkSummaries', [ids || []]));
  ipcMain.handle('issues:filter-options', (_event, project) => runDataAccessWorker('getIssueFilterOptions', [project || '']));
  ipcMain.handle('issues:overview-stats', () => runDataAccessWorker('getIssueOverviewStats'));
  ipcMain.handle('issues:period-report', (_event, filters) => runDataAccessWorker('getCalendarPeriodReport', [filters || {}]));
  ipcMain.handle('issues:business-report', (_event, filters) => runDataAccessWorker('getBusinessBoardReport', [filters || {}]));
  ipcMain.handle('business:sprint-list', () => runDataAccessWorker('listBusinessSprints'));
  ipcMain.handle('business:sprint-report', (_event, filters) => runDataAccessWorker('getBusinessSprintReport', [filters || {}]));
  ipcMain.handle('issues:sprint-list', (_event, sprintId, offset, limit) => runDataAccessWorker('listIssues', [{ sprintId, offset, limit, sortBy: 'key', workflowScope: 'delivery' }]));
  ipcMain.handle('issues:details', (_event, key, includeActivity) => runDataAccessWorker('getIssueDetails', [key, Boolean(includeActivity)]));
  ipcMain.handle('issues:activity', (_event, key, offset, limit) => runDataAccessWorker('getIssueActivity', [key, offset, limit]));
  ipcMain.handle('sprints:details', (_event, sprintId) => runDataAccessWorker('getSprintDetails', [sprintId]));
  ipcMain.handle('jira:open-issue', async (_event, key) => {
    const issueKey = String(key || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) throw new Error('کلید Jira معتبر نیست.');
    const base = jiraBaseUrl();
    const target = new URL(`browse/${encodeURIComponent(issueKey)}`, `${base.toString().replace(/\/$/, '')}/`);
    await shell.openExternal(target.toString());
    return { opened: true };
  });
  ipcMain.handle('jira:open-sprint', async (_event, input) => {
    const sprintId = String(input?.sprintId || '').trim();
    const boardId = String(input?.boardId || '').trim();
    if (!/^\d+$/.test(sprintId) || !/^\d+$/.test(boardId)) throw new Error('شناسهٔ Sprint یا Board معتبر نیست.');
    const base = jiraBaseUrl();
    const query = new URLSearchParams({ rapidView: boardId, view: 'planning', selectedSprint: sprintId });
    const target = new URL(`secure/RapidBoard.jspa?${query.toString()}`, `${base.toString().replace(/\/$/, '')}/`);
    await shell.openExternal(target.toString());
    return { opened: true };
  });
  ipcMain.handle('issues:link', (_event, input) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const link = saveLocalIssueLink(db, input);
      db.exec('COMMIT');
      invalidateSnapshot();
      return link;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  ipcMain.handle('issues:unlink', (_event, id) => { const result = removeLocalIssueLink(db, id); if (result.ok) invalidateSnapshot(); return result; });

  ipcMain.handle('import:begin', (_event, requestedSourceName) => {
    if (workspaceMaintenance || workspaceBackupInProgress || activeImportRun || syncWorker) throw new Error('همگام‌سازی، پشتیبان‌گیری یا import دیگری در حال اجراست.');
    let config = getConfig(db);
    const attestation = createOfflineAdapter(config, randomUUID).attestImportSource(requestedSourceName);
    if (attestation.changed) {
      const eventType = config.sourceInstance.provider === 'offline-json' ? 'offline-source-attested' : 'source-label-attested';
      config = saveConfig(db, { ...config, sourceInstance: attestation.sourceInstance }, eventType);
      invalidateSnapshot();
    }
    const sourceName = attestation.sourceInstance.displayName || config.sourceInstance.displayName;
    activeImportRun = randomUUID();
    db.prepare('INSERT INTO import_runs(id,started_at,files_json) VALUES(?,?,?)').run(activeImportRun, new Date().toISOString(), '[]');
    invalidateSnapshot();
    return { runId: activeImportRun, sourceInstanceId: config.sourceInstance.id, sourceName };
  });
  ipcMain.handle('import:register-file', (_event, meta) => {
    if (!activeImportRun) throw new Error('نشست import آغاز نشده است.');
    const now = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO import_files(id,run_id,file_name,kind,size_bytes,metadata_json,imported_at) VALUES(?,?,?,?,?,?,?)')
      .run(`${activeImportRun}:${meta.id || randomUUID()}`, activeImportRun, String(meta.fileName || 'JSON').slice(0, 260), meta.kind, Number(meta.sizeBytes) || null, JSON.stringify(meta.metadata || {}), now);
    if (String(meta.kind).includes('catalog') || String(meta.kind).includes('metadata')) require('./jira-metadata.cjs').cacheMetadata(db, `uploaded:${meta.kind}`, meta.metadata);
    const files = db.prepare('SELECT file_name FROM import_files WHERE run_id=? ORDER BY imported_at').all(activeImportRun).map((row) => row.file_name);
    db.prepare('UPDATE import_runs SET files_json=? WHERE id=?').run(JSON.stringify(Array.from(new Set(files))), activeImportRun);
    invalidateSnapshot();
    return { ok: true };
  });
  ipcMain.handle('import:issue-batch', (_event, batch, source) => {
    if (!activeImportRun) throw new Error('نشست import آغاز نشده است.');
    const update = db.prepare('UPDATE import_runs SET issues_added=issues_added+?,issues_updated=issues_updated+?,duplicates=duplicates+?,conflicts=conflicts+?,skipped=skipped+? WHERE id=?');
    let added = 0; let updated = 0; let duplicates = 0; let conflicts = 0; let skipped = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const issue of batch) {
        const state = saveIssue(db, issue, source, activeImportRun).status;
        if (state === 'added') added += 1;
        else if (state === 'updated') updated += 1;
        else if (state === 'duplicate') duplicates += 1;
        else if (state === 'conflict') conflicts += 1;
        else skipped += 1;
      }
      update.run(added, updated, duplicates, conflicts, skipped, activeImportRun);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    invalidateSnapshot();
    const counts = { added, updated, duplicates, conflicts, skipped };
    mainWindow?.webContents.send('import:progress', { phase: 'issues', batchSize: batch.length, ...counts });
    return counts;
  });
  ipcMain.handle('import:sprint-batch', (_event, batch, source) => {
    if (!activeImportRun) throw new Error('نشست import آغاز نشده است.');
    let added = 0; let updated = 0; let duplicates = 0; let conflicts = 0; let skipped = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const sprint of batch) {
        const state = saveSprint(db, sprint, source, activeImportRun).status;
        if (state === 'added') added += 1;
        else if (state === 'updated') updated += 1;
        else if (state === 'duplicate') duplicates += 1;
        else if (state === 'conflict') conflicts += 1;
        else skipped += 1;
      }
      db.prepare('UPDATE import_runs SET sprints_added=sprints_added+?,sprints_updated=sprints_updated+?,duplicates=duplicates+?,conflicts=conflicts+?,skipped=skipped+? WHERE id=?')
        .run(added, updated, duplicates, conflicts, skipped, activeImportRun);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    invalidateSnapshot();
    const counts = { added, updated, duplicates, conflicts, skipped };
    mainWindow?.webContents.send('import:progress', { phase: 'sprints', batchSize: batch.length, ...counts });
    return counts;
  });
  ipcMain.handle('import:finish', (_event, note = null) => {
    if (!activeImportRun) return { issueCount: db.prepare('SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)').get().count };
    const id = activeImportRun;
    db.prepare('UPDATE import_runs SET finished_at=?,note=? WHERE id=?').run(new Date().toISOString(), note ? String(note).slice(0, 500) : null, id);
    activeImportRun = null;
    invalidateSnapshot();
    return { issueCount: db.prepare('SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)').get().count };
  });

  ipcMain.handle('records:save', (_event, input) => {
    const record = safeRecord(input, getConfig(db));
    if (['request', 'action'].includes(record.kind)) throw new Error('درخواست و تعهد جدید باید به‌صورت تسک واقعی در Jira ایجاد شوند.');
    const id = input.id || randomUUID();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT id,created_at,payload_json FROM product_records WHERE id=?').get(id);
      db.prepare('INSERT INTO product_records(id,kind,title,payload_json,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,payload_json=excluded.payload_json,updated_at=excluded.updated_at,archived_at=NULL')
        .run(id, record.kind, record.title, JSON.stringify(record.payload), existing?.created_at || now, now);
      createRecordEvent(id, existing ? 'updated' : 'created', { kind: record.kind, title: record.title, before: existing ? safeJson(existing.payload_json, {}) : null, after: record.payload });
      db.exec('COMMIT');
      invalidateSnapshot();
      return { id, kind: record.kind, title: record.title, payload: record.payload, createdAt: existing?.created_at || now, updatedAt: now };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  ipcMain.handle('records:archive', (_event, id) => {
    const record = db.prepare('SELECT id,kind,title,payload_json FROM product_records WHERE id=?').get(String(id));
    if (!record) return { ok: false };
    if (['request', 'action'].includes(record.kind)) throw new Error('حذف یا بایگانی درخواست و تعهد مجاز نیست.');
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE product_records SET archived_at=?,updated_at=? WHERE id=?').run(now, now, record.id);
      createRecordEvent(record.id, 'archived', { kind: record.kind, title: record.title });
      db.exec('COMMIT');
      invalidateSnapshot();
      return { ok: true };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  ipcMain.handle('records:relationship:save', (_event, input) => {
    const relationship = saveRecordRelationship(db, input);
    invalidateSnapshot();
    return relationship;
  });
  ipcMain.handle('records:relationship:archive', (_event, id) => {
    const result = archiveRecordRelationship(db, id);
    if (result.ok) invalidateSnapshot();
    return result;
  });
  ipcMain.handle('records:relationships:export', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export product relationships',
      defaultPath: `Axiloom-relationships-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV relationship export', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const columns = ['source_type','source_id','source_label','relationship','target_type','target_id','target_label','evidence','source_origin','source_reference','attributed_to','created_at','updated_at'];
    const csvCell = (value) => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = listRecordRelationships(db).map((relationship) => ({
      source_type: relationship.sourceType, source_id: relationship.sourceId, source_label: relationship.sourceLabel,
      relationship: relationship.relationship, target_type: relationship.targetType, target_id: relationship.targetId,
      target_label: relationship.targetLabel, evidence: relationship.evidence, source_origin: relationship.sourceOrigin,
      source_reference: relationship.sourceReference, attributed_to: relationship.attributedTo,
      created_at: relationship.createdAt, updated_at: relationship.updatedAt,
    }));
    const csv = `\uFEFF${[columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n')}\r\n`;
    await fs.promises.writeFile(filePath, csv, 'utf8');
    return { filePath };
  });

  ipcMain.handle('workspace:backup', async () => {
    if (activeImportRun || syncWorker || workspaceBackupInProgress) throw new Error('هنگام import یا همگام‌سازی Jira پشتیبان نگیرید؛ پس از پایان دوباره تلاش کنید.');
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, { title: 'پشتیبان فضای Axiloom', defaultPath: `Axiloom-${new Date().toISOString().slice(0, 10)}.axw`, filters: [{ name: 'Axiloom Workspace', extensions: ['axw'] }] });
    if (canceled || !filePath) return { canceled: true };
    if (path.resolve(filePath) === path.resolve(databaseFile)) throw new Error('مسیر فایل پشتیبان باید با فایل فضای کاری محلی متفاوت باشد.');
    if (activeImportRun || syncWorker || workspaceBackupInProgress) throw new Error('یک import یا همگام‌سازی در این فاصله آغاز شد؛ پس از پایان دوباره تلاش کنید.');
    workspaceBackupInProgress = true;
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${randomUUID()}`);
    let previousPath = '';
    try {
      await runWorkspaceDatabaseWorker('backup', temporaryPath);
      if (fs.existsSync(filePath)) {
        previousPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.previous-${randomUUID()}`);
        fs.renameSync(filePath, previousPath);
      }
      try { fs.renameSync(temporaryPath, filePath); }
      catch (error) {
        if (previousPath && fs.existsSync(previousPath)) fs.renameSync(previousPath, filePath);
        throw error;
      }
      if (previousPath) { try { fs.rmSync(previousPath, { force: true }); } catch { /* Keep the previous valid backup if cleanup is blocked. */ } }
      return { filePath };
    } catch (error) {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${temporaryPath}${suffix}`, { force: true });
      if (previousPath && fs.existsSync(previousPath) && !fs.existsSync(filePath)) fs.renameSync(previousPath, filePath);
      throw error;
    } finally { workspaceBackupInProgress = false; }
  });
  ipcMain.handle('workspace:restore', async () => {
    const busy = () => workspaceMaintenance || activeImportRun || syncWorker || workspaceBackupInProgress || workspaceBackupWorkers.size || snapshotWorkers.size || snapshotFlights.size || dataAccessWorkers.size || dataAccessQueue.length;
    if (busy()) throw new Error('برای بازیابی، صبر کنید تا import، همگام‌سازی و خواندن داده‌ها تمام شود.');
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, { title: 'بازیابی فضای Axiloom', properties: ['openFile'], filters: [{ name: 'Axiloom Workspace', extensions: ['axw', 'sqlite', 'db'] }] });
    if (canceled || !filePaths[0]) return { canceled: true };
    const source = filePaths[0];
    const sourceHandle = fs.openSync(source, 'r');
    const headerBytes = Buffer.alloc(16);
    try { fs.readSync(sourceHandle, headerBytes, 0, headerBytes.length, 0); }
    finally { fs.closeSync(sourceHandle); }
    if (headerBytes.toString('ascii') !== 'SQLite format 3\u0000') throw new Error('فایل انتخاب‌شده پایگاه دادهٔ SQLite معتبر نیست.');
    const tempPath = path.join(workspaceDirectory, `workspace.restore-${randomUUID()}.sqlite`);
    try {
      await fs.promises.copyFile(source, tempPath);
      await runWorkspaceDatabaseWorker('validate', tempPath);
    } catch (error) {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${tempPath}${suffix}`, { force: true });
      throw error;
    }
    if (busy()) {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${tempPath}${suffix}`, { force: true });
      throw new Error('در این فاصله یک عملیات خواندن یا نوشتن آغاز شد؛ فضای فعلی بدون تغییر باقی ماند.');
    }
    workspaceMaintenance = true;
    const previousPath = path.join(workspaceDirectory, `workspace.pre-restore-${Date.now()}-${randomUUID()}.sqlite`);
    let databaseClosed = false;
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      databaseClosed = true;
      for (const suffix of ['-wal', '-shm']) fs.rmSync(`${databaseFile}${suffix}`, { force: true });
      fs.renameSync(databaseFile, previousPath);
      try { fs.renameSync(tempPath, databaseFile); }
      catch (error) { fs.renameSync(previousPath, databaseFile); throw error; }
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${tempPath}${suffix}`, { force: true });
      app.relaunch();
      app.quit();
      return { restored: true };
    } catch (error) {
      if (!fs.existsSync(databaseFile) && fs.existsSync(previousPath)) {
        try { fs.renameSync(previousPath, databaseFile); }
        catch {
          workspaceMaintenance = true;
          throw new Error(`فضای فعلی حفظ شده است، اما بازگردانی خودکار فایل فعال ناموفق بود. فایل بازیابی در این مسیر باقی مانده است: ${previousPath}`);
        }
      }
      if (databaseClosed && fs.existsSync(databaseFile)) {
        try { db = openDatabase(databaseFile); }
        catch {
          workspaceMaintenance = true;
          throw new Error(`پایگاه داده دوباره باز نشد؛ فایل بازیابی برای بازگردانی دستی حفظ شده است: ${previousPath}`);
        }
      }
      workspaceMaintenance = false;
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${tempPath}${suffix}`, { force: true });
      throw error;
    }
  });

  ipcMain.handle('reports:xlsx', async (_event, report) => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, { title: 'خروجی Excel', defaultPath: `${report.fileName || 'Axiloom'}.xlsx`, filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
    if (canceled || !filePath) return { canceled: true };
    const prepared = prepareReportExport(report);
    writeWorkbook(filePath, prepared.sheets || []);
    return { filePath };
  });
  ipcMain.handle('reports:pdf', async (_event, report) => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, { title: 'خروجی PDF', defaultPath: `${report.fileName || 'Axiloom'}.pdf`, filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
    if (canceled || !filePath) return { canceled: true };
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const html = createReportHtml({ ...prepareReportExport(report), locale: getConfig(db).organization.locale });
    const temporaryHtml = path.join(workspaceDirectory, `report-${randomUUID()}.html`);
    try {
      await fs.promises.writeFile(temporaryHtml, html, 'utf8');
      await printWindow.loadFile(temporaryHtml);
      const pdf = await printWindow.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true, margins: { top: 0.45, bottom: 0.45, left: 0.45, right: 0.45 } });
      await fs.promises.writeFile(filePath, pdf);
    } finally { printWindow.close(); await fs.promises.rm(temporaryHtml, { force: true }); }
    return { filePath };
  });

  ipcMain.handle('jira:use-pat', (_event, token, save) => rememberPat(token, save));
  ipcMain.handle('jira:forget-pat', () => forgetPat());
  ipcMain.handle('jira:create-pat', async (_event, username, password, name, expiryDays, save) => {
    if (!String(username || '').trim() || !String(password || '')) throw new Error('نام کاربری و رمز عبور را وارد کنید.');
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const body = await jiraFetch('rest/pat/latest/tokens', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: String(name || 'Axiloom').slice(0, 80), expirationDuration: Math.max(1, Math.min(365, Number(expiryDays) || 30)) }),
    }, '');
    const token = body.rawToken || body.token || body.tokenString || body.password || '';
    const saved = token ? rememberPat(token, save) : { connected: false, saved: false };
    return { created: true, token: token || null, metadata: { id: body.id || body.tokenId || '', name: body.name || name, createdAt: body.createdAt || body.created || '', expiresAt: body.expirationTime || body.expiresAt || '' }, saved };
  });
  ipcMain.handle('jira:list-pats', async () => {
    const body = await jiraFetch('rest/pat/latest/tokens', { method: 'GET' }, savedPat());
    const records = Array.isArray(body) ? body : body?.tokens || [];
    return records.filter((item) => /^\d+$/.test(String(item?.id ?? item?.tokenId ?? ''))).map((item) => ({
      id: String(item.id ?? item.tokenId),
      name: String(item.name || ''),
      createdAt: String(item.createdAt || item.created || ''),
      expiresAt: String(item.expirationTime || item.expiresAt || ''),
    }));
  });
  ipcMain.handle('jira:revoke-pat', async (_event, tokenId) => {
    if (!/^\d+$/.test(String(tokenId))) throw new Error('شناسهٔ PAT معتبر نیست.');
    await jiraFetch(`rest/pat/latest/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' }, savedPat());
    forgetPat();
    return { revoked: true };
  });
  ipcMain.handle('jira:test', async () => {
    const token = savedPat();
    if (!token) throw new Error('ابتدا PAT را وارد یا در Jira ایجاد کنید.');
    const user = await jiraFetch('rest/api/2/myself', { method: 'GET' }, token);
    return { ok: true, displayName: user?.displayName || '', account: user?.name || user?.key || '' };
  });
  ipcMain.handle('jira:provider-capabilities', (_event, providerId) => describeProvider(providerId || getConfig(db).sourceInstance.provider));
  ipcMain.handle('jira:current-user', async () => {
    const token = savedPat();
    if (!token) return null;
    const user = await jiraFetch('rest/api/2/myself', { method: 'GET' }, token);
    return { key: user?.key || '', name: user?.name || '', accountId: user?.accountId || '', displayName: user?.displayName || '' };
  });
  ipcMain.handle('jira:start-sync', (_event, resume) => {
    if (workspaceMaintenance || workspaceBackupInProgress) throw new Error('فضای کاری در حال پشتیبان‌گیری یا تعویض است؛ پس از پایان دوباره تلاش کنید.');
    if (syncWorker) throw new Error('همگام‌سازی دیگری در حال اجراست.');
    if (activeImportRun) throw new Error('تا پایان import، همگام‌سازی Jira آغاز نمی‌شود.');
    const token = savedPat();
    if (!token) throw new Error('برای دریافت اطلاعات Jira ابتدا PAT را وارد کنید.');
    const config = getConfig(db);
    if (!config.jiraUrl) throw new Error('آدرس Jira را در تنظیمات وارد کنید.');
    const worker = new Worker(path.join(__dirname, 'jira-worker.cjs'), { workerData: { dbPath: databaseFile, config, token, resume: Boolean(resume) } });
    syncWorker = worker;
    let terminalMessageReceived = false;
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        // Progress doesn't change the data-generation contract. Invalidate once
        // on completion so an in-flight snapshot isn't discarded and restarted
        // after every page of a large sync.
        mainWindow?.webContents.send('jira:progress', message.value);
        return;
      }
      if (message.type === 'done' || message.type === 'error' || message.type === 'cancelled') {
        terminalMessageReceived = true;
        invalidateSnapshot();
        mainWindow?.webContents.send('jira:progress', { phase: message.type, ...(message.value || {}), error: message.error || '' });
        if (syncWorker === worker) syncWorker = null;
      }
    });
    worker.on('error', (error) => {
      if (!terminalMessageReceived) {
        terminalMessageReceived = true;
        invalidateSnapshot();
        mainWindow?.webContents.send('jira:progress', { phase: 'error', error: error.message });
      }
      if (syncWorker === worker) syncWorker = null;
    });
    worker.on('exit', (code) => {
      if (!terminalMessageReceived) {
        invalidateSnapshot();
        mainWindow?.webContents.send('jira:progress', { phase: 'error', error: `پردازهٔ همگام‌سازی بدون نتیجهٔ نهایی متوقف شد (کد ${code}).` });
      }
      if (syncWorker === worker) syncWorker = null;
    });
    return { started: true };
  });
  ipcMain.handle('jira:cancel-sync', () => {
    if (!syncWorker) return { requested: false };
    syncWorker.postMessage({ type: 'cancel' });
    return { requested: true };
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function reportEngineFingerprint() {
  const hash = createHash('sha256');
  for (const file of ['snapshot.cjs', 'metrics.cjs', 'semantic-mapping.cjs', 'team-attribution.cjs', 'database.cjs']) {
    hash.update(fs.readFileSync(path.join(__dirname, file)));
  }
  return `sha256:${hash.digest('hex')}`;
}

function prepareReportExport(report) {
  const config = getConfig(db);
  return attachReportContext(report, {
    workspaceName: activeWorkspace?.name || config.workspaceName,
    organizationName: config.organization?.name,
    sourceProvider: config.sourceInstance?.provider,
    sourceId: config.sourceInstance?.id,
    configurationRevision: config.configurationRevision,
    engineFingerprint: reportEngineFingerprint(),
    appVersion: app.getVersion(),
    locale: config.organization?.locale,
    timeZone: config.calendar?.timeZone || config.organization?.timeZone,
    generatedAt: new Date().toISOString(),
  });
}

function createReportHtml(report) {
  const locale = String(report.locale || 'en-US');
  const direction = locale.toLowerCase().startsWith('fa') ? 'rtl' : 'ltr';
  const title = escapeHtml(report.title || 'گزارش Axiloom');
  const subtitle = escapeHtml(report.subtitle || new Date().toLocaleString(locale));
  const fontAssets = path.join(__dirname, 'build', 'assets');
  const fontFaces = ['arabic', 'latin'].flatMap((subset) => ['400', '700'].flatMap((weight) => {
    const prefix = `vazirmatn-${subset}-${weight}-normal`;
    const file = fs.existsSync(fontAssets) ? fs.readdirSync(fontAssets).find((name) => name.startsWith(prefix) && name.endsWith('.woff2')) : null;
    return file ? [`@font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontAssets, file)).toString('base64')}) format("woff2");font-style:normal;font-weight:${weight};font-display:swap}`] : [];
  })).join('');
  const sheets = (report.sheets || []).map((sheet) => {
    const rows = sheet.rows || [];
    if (!rows.length) return '';
    const header = `<tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr>`;
    const body = rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    return `<section><h2>${escapeHtml(sheet.name)}</h2><table><thead>${header}</thead><tbody>${body}</tbody></table></section>`;
  }).join('');
  return `<!doctype html><html lang="${escapeHtml(locale)}" dir="${direction}"><head><meta charset="utf-8"><style>
    ${fontFaces}*{box-sizing:border-box}body{font-family:Vazirmatn,Tahoma,Arial,sans-serif;color:#172b3a;background:#fff;margin:0;padding:28px;font-size:10px}h1{font-size:20px;margin:0 0 8px;color:#17324d}p{color:#64748b;margin:0 0 24px}h2{font-size:14px;margin:20px 0 8px;color:#0e7490}table{border-collapse:collapse;width:100%;margin-bottom:18px;page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}th,td{border:1px solid #d9e1e8;padding:5px 6px;text-align:start;vertical-align:top;max-width:260px;overflow-wrap:anywhere}th{background:#17324d;color:#fff;font-weight:700}tbody tr:nth-child(even){background:#f5f7fa}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>${title}</h1><p>${subtitle}</p>${sheets}</body></html>`;
}

app.setName('Axiloom');
workspaceRoot = getWorkspacePath();
workspaceIndex = workspaceRegistry.loadRegistry(workspaceRoot);
activeWorkspace = workspaceRegistry.activeWorkspace(workspaceRoot, workspaceIndex);
workspaceDirectory = activeWorkspace.directory;
databaseFile = activeWorkspace.databaseFile;
app.whenReady().then(() => {
  db = openDatabase(databaseFile);
  registerHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (db) { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* App is already shutting down. */ } } });
