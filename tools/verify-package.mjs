import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const directory = path.resolve(process.argv[2] || 'release/Axiloom-Portable/resources/app');
const require = createRequire(path.join(directory, 'package.json'));
for (const file of ['main.cjs', 'preload.cjs', 'build/index.html', '../shared/resource-limits.json', '../shared/record-templates.json']) {
  assert.ok(fs.existsSync(path.join(directory, file)), `Missing packaged dependency: ${file}`);
}
// Resolve dependencies from the distributed layout, rather than the source tree.
for (const file of ['configuration.cjs', 'database.cjs', 'jira-management.cjs', 'jira-providers.cjs', 'jira-metadata.cjs', 'jira-page-budget.cjs']) {
  require(`./${file}`);
}
console.log('Packaged runtime dependency checks passed.');
