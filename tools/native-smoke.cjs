const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const resultPath = process.env.AXILOOM_SMOKE_RESULT;
if (!resultPath || !process.env.PORTABLE_EXECUTABLE_DIR) throw new Error('Set AXILOOM_SMOKE_RESULT and an isolated PORTABLE_EXECUTABLE_DIR before running this test.');
const timer = setTimeout(() => finish({ ok: false, error: 'Native smoke timed out' }), 30000);
function finish(result) {
  clearTimeout(timer);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-fail-load', (_event, code, message) => finish({ ok: false, error: `${code}: ${message}` }));
  contents.once('did-finish-load', async () => {
    try {
      const result = await contents.executeJavaScript(`(async () => {
        if (!window.axiloom) throw new Error('Preload bridge missing');
        const config = await window.axiloom.getConfig();
        const workspace = await window.axiloom.getWorkspaceInfo();
        const snapshot = await window.axiloom.getSnapshot();
        const record = await window.axiloom.saveRecord({ kind: 'objective', title: 'Synthetic native smoke objective', payload: {} });
        const firstPage = await window.axiloom.listRecords({});
        const second = await window.axiloom.createWorkspace('Synthetic isolated smoke workspace');
        const isolatedPage = await window.axiloom.listRecords({});
        await window.axiloom.activateWorkspace(workspace.id);
        const restoredPage = await window.axiloom.listRecords({});
        if (!firstPage.items.some(item => item.id === record.id)) throw new Error('Saved record missing');
        if (isolatedPage.total !== 0) throw new Error('New workspace contains unexpected records');
        if (!restoredPage.items.some(item => item.id === record.id)) throw new Error('Record did not survive workspace reopen');
        return { ok: true, workspaceId: workspace.id, databasePath: workspace.path,
          recordId: record.id, isolatedWorkspaceId: second.id, recordPersistenceVerified: true,
          configRevision: config.configurationRevision, snapshotKeys: Object.keys(snapshot),
          renderedTextLength: document.body.innerText.length };
      })()`);
      finish(result);
    } catch (error) { finish({ ok: false, error: error.stack }); }
  });
});
require(path.resolve(__dirname, '../release/Axiloom-Portable/resources/app/main.cjs'));
