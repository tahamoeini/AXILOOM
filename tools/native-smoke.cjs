const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const resultPath = process.env.AXILOOM_SMOKE_RESULT;
if (!resultPath || !process.env.PORTABLE_EXECUTABLE_DIR) throw new Error('Set AXILOOM_SMOKE_RESULT and an isolated PORTABLE_EXECUTABLE_DIR before running this test.');
const timer = setTimeout(() => finish({ ok: false, error: 'Native smoke timed out' }), 30000);
dialog.showSaveDialog = async (_window, options) => ({ canceled: false,
  filePath: path.join(process.env.PORTABLE_EXECUTABLE_DIR, options.defaultPath) });
function finish(result) {
  clearTimeout(timer);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}
let claimedRenderer = false;
app.on('web-contents-created', (_event, contents) => {
  if (claimedRenderer) return;
  claimedRenderer = true;
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
        const report = { title: 'Synthetic native export', fileName: 'native-smoke',
          sheets: [{ name: 'Evidence', rows: [['Title', 'Count'], ['Synthetic objective', 1]] }] };
        const xlsx = await window.axiloom.exportXlsx(report);
        const pdf = await window.axiloom.exportPdf(report);
        return { ok: true, workspaceId: workspace.id, databasePath: workspace.path,
          xlsxPath: xlsx.filePath, pdfPath: pdf.filePath,
          recordId: record.id, isolatedWorkspaceId: second.id, recordPersistenceVerified: true,
          configRevision: config.configurationRevision, snapshotKeys: Object.keys(snapshot),
          renderedTextLength: document.body.innerText.length };
      })()`);
      const xlsx = fs.readFileSync(result.xlsxPath);
      const pdf = fs.readFileSync(result.pdfPath);
      if (xlsx.subarray(0, 2).toString() !== 'PK' || xlsx.length < 1000) throw new Error('Invalid XLSX output');
      if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length < 1000) throw new Error('Invalid PDF output');
      finish({ ...result, xlsxBytes: xlsx.length, pdfBytes: pdf.length });
    } catch (error) { finish({ ok: false, error: error.stack }); }
  });
});
require(path.resolve(__dirname, '../release/Axiloom-Portable/resources/app/main.cjs'));
