import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(path.join(process.cwd(), 'src/reporting.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { createReportScope } = module.exports;

const snapshot = {
  quality: {
    findings: [{ severity: 'warning', count: 3 }, { severity: 'info', count: 2 }],
    incompleteHistories: 1, conflicts: 0,
  },
};
const scope = createReportScope(snapshot, {
  view: 'Delivery', semantics: 'report-wide',
  filters: { team: ['Platform', 'Research'], from: '2026-01-01', empty: '', enabled: false },
  filterLabels: { team: 'Teams', from: 'Start date', enabled: 'Include unmapped' },
  primaryRowCount: 12, matchingRowCount: 12,
  notes: ['Workspace quality scope', 'Workspace quality scope'],
});
assert.equal(scope.view, 'Delivery');
assert.equal(scope.semantics, 'report-wide');
assert.deepEqual(JSON.parse(JSON.stringify(scope.filters)), [
  { label: 'Teams', value: 'Platform, Research' },
  { label: 'Start date', value: '2026-01-01' },
  { label: 'Include unmapped', value: 'No' },
]);
assert.equal(scope.primaryRowCount, 12);
assert.equal(scope.quality.warningCount, 3);
assert.equal(scope.quality.infoCount, 2);
assert.equal(scope.quality.incompleteHistories, 1);
assert.deepEqual(JSON.parse(JSON.stringify(scope.notes)), ['Workspace quality scope']);
console.log('Renderer report scope checks passed.');
