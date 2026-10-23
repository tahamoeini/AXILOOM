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
