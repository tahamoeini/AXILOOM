import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const start = source.indexOf("  ipcMain.handle('workspace:backup'");
const end = source.indexOf("  ipcMain.handle('reports:xlsx'", start);
assert.ok(start >= 0 && end > start);

const profileStart = source.indexOf("  ipcMain.handle('app:import-config-profile'");
const profileEnd = source.indexOf("  ipcMain.handle('app:snapshot'", profileStart);
assert.ok(profileStart >= 0 && profileEnd > profileStart);
for (const channel of ['workspace:backup', 'workspace:restore', 'app:import-config-profile', 'app:export-config-profile']) {
  const handlers = new Map();
  const context = vm.createContext({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    assertWorkspacePaths() {}, databaseFile: 'workspace-a.sqlite',
    activeImportRun: null, syncWorker: null, workspaceBackupInProgress: false,
    jiraManagementOperations: 0,
    workspaceMaintenance: false, workspaceBackupWorkers: new Set(),
    snapshotWorkers: new Set(), snapshotFlights: new Set(),
    dataAccessWorkers: new Set(), dataAccessQueue: [], mainWindow: null,
    dialog: {
      async showSaveDialog() {
        context.databaseFile = 'workspace-b.sqlite';
        return { filePath: 'backup.axw', canceled: false };
      },
      async showOpenDialog() {
        context.databaseFile = 'workspace-b.sqlite';
        return { filePaths: ['backup.axw'], canceled: false };
      },
    },
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext(source.slice(profileStart, profileEnd), context);
  // No filesystem or worker capability is supplied: rejection must precede I/O.
  await assert.rejects(handlers.get(channel)(), /active workspace changed/);
}
console.log('Backup, restore, and profile dialog workspace-switch regression checks passed.');

const configStart = source.indexOf("  ipcMain.handle('app:save-config'");
const configEnd = source.indexOf("  ipcMain.handle('app:validate-config'", configStart);
assert.ok(configStart >= 0 && configEnd > configStart);
const handlers = new Map();
const locked = vm.createContext({
  jiraManagementOperations: 1,
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
});
vm.runInContext(source.slice(configStart, configEnd), locked);
assert.throws(() => handlers.get('app:save-config')(null, {}), /active Jira operation/);
for (const [begin, end, call] of [
  ['function rememberPat(', 'function clearPat(', "rememberPat('synthetic', false)"],
  ['async function forgetPat(', 'function registerHandlers(', 'forgetPat()'],
]) {
  const first = source.indexOf(begin);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  vm.runInContext(source.slice(first, last), locked);
  if (call.startsWith('forget')) await assert.rejects(vm.runInContext(call, locked), /active Jira operation/);
  else assert.throws(() => vm.runInContext(call, locked), /active Jira operation/);
}
console.log('In-flight Jira configuration and credential guards passed.');
