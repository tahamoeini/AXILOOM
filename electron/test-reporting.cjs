const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { attachReportContext, buildReportContextRows, normalizeReportScope } = require('./reporting.cjs');
const { writeWorkbook } = require('./xlsx.cjs');

const runtime = {
  workspaceName: 'Generic Product Workspace', organizationName: 'Example Org', sourceProvider: 'jira-datacenter', sourceId: 'source-1',
  configurationRevision: 8, engineFingerprint: 'sha256:example', appVersion: '1.0.0', locale: 'en-GB', timeZone: 'Europe/London', generatedAt: '2026-10-22T12:00:00.000Z',
};
const report = {
  title: 'Delivery report',
  scope: {
    view: 'Team and sprint', semantics: 'report-wide', primaryRowCount: 3, matchingRowCount: 3,
    filters: [{ label: 'Teams', value: 'Platform, Research' }, { label: 'From', value: '2026-01-01' }, { label: '', value: 'discard' }],
    quality: { scope: 'workspace', warningCount: 4, infoCount: 2, incompleteHistories: 1, conflicts: 0 },
    notes: ['Workspace-level quality context; not filtered with report rows.', 'Workspace-level quality context; not filtered with report rows.'],
  },
  sheets: [{ name: 'Metrics', rows: [['Sprint', 'Completed'], ['Sprint 1', 5]] }],
};
const prepared = attachReportContext(report, runtime);
assert.equal(prepared.sheets[0].name, 'Report Context');
assert.equal(prepared.sheets[1].name, 'Metrics');
const rows = prepared.sheets[0].rows;
assert.ok(rows.some((row) => row[0] === 'Configuration revision' && row[1] === 8));
assert.ok(rows.some((row) => row[0] === 'Report engine fingerprint' && row[1] === 'sha256:example'));
assert.ok(rows.some((row) => row[0] === 'Filter semantics' && row[1] === 'report-wide'));
assert.ok(rows.some((row) => row[0] === 'Teams' && row[1] === 'Platform, Research'));
assert.equal(rows.filter((row) => row[0] === 'Quality and interpretation notes').length, 1);
assert.equal(normalizeReportScope({ semantics: 'execute-anything', primaryRowCount: -3, filters: [{ label: 'x'.repeat(200), value: 'y'.repeat(900) }] }, report).semantics, 'unspecified');
assert.equal(normalizeReportScope(null, { title: 'Legacy report' }).view, 'Legacy report');
const legacyRows = buildReportContextRows({}, runtime);
assert.ok(legacyRows.some((row) => row[0] === 'Filter details were not supplied by this report view.'));
const tempDirectory = path.join(process.cwd(), '.test-tmp');
fs.mkdirSync(tempDirectory, { recursive: true });
const workbookPath = path.join(tempDirectory, 'report-context-check.xlsx');
try {
  writeWorkbook(workbookPath, prepared.sheets);
  const workbook = fs.readFileSync(workbookPath);
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= workbook.length && workbook.readUInt32LE(offset) === 0x04034b50) {
    const method = workbook.readUInt16LE(offset + 8);
    const compressedSize = workbook.readUInt32LE(offset + 18);
    const nameLength = workbook.readUInt16LE(offset + 26);
    const extraLength = workbook.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = workbook.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = workbook.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? zlib.inflateRawSync(compressed).toString('utf8') : compressed.toString('utf8'));
    offset = dataStart + compressedSize;
  }
  assert.match(entries.get('xl/workbook.xml') || '', /Report Context/);
  assert.match(entries.get('xl/worksheets/sheet1.xml') || '', /Report engine fingerprint/);
  assert.match(entries.get('xl/worksheets/sheet1.xml') || '', /Platform, Research/);
} finally { fs.rmSync(workbookPath, { force: true }); }
console.log('Report scope and context checks passed.');
