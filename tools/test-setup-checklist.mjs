import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = readFileSync(resolve('src/setup-checklist.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exports = {};
new Function('exports', outputText)(exports);

function makeConfig(overrides = {}) {
  return {
    configurationRevision: 0,
    modules: { delivery: false, portfolio: false, objectives: false, productIntelligence: true, productIntake: false, commitments: false, businessSprint: false, outcomes: true, organizationAnalytics: false },
    jiraUrl: '', sourceInstance: { displayName: '' },
    projects: [], projectRoles: { productIntake: [], technicalDelivery: [], commitments: [] },
    teams: [], teamAssignments: { projects: [], components: [], issueOverrides: [] }, boardRoutes: [], fieldMappings: [],
    workflows: { delivery: { statuses: [] }, intake: { statuses: [] }, commitment: { statuses: [] } },
    calendar: { configured: false, workIntervals: [] },
    ...overrides,
  };
}

function byId(steps, id) {
  return steps.find((step) => step.id === id);
}

const localSteps = exports.buildSetupSteps(makeConfig(), true, 0);
assert.equal(byId(localSteps, 'settings-workspace').complete, true);
for (const id of ['settings-projects', 'settings-teams', 'settings-fields', 'settings-workflows', 'settings-calendar', 'import-json-action']) {
  assert.equal(byId(localSteps, id).optional, true, `${id} should be optional in a product-only local workspace`);
  assert.equal(byId(localSteps, id).complete, false, `${id} should not look configured by defaults`);
}

const deliveryConfig = makeConfig({
  configurationRevision: 2,
  modules: { ...makeConfig().modules, delivery: true },
  sourceInstance: { displayName: 'Synthetic Jira' },
  projects: ['SAMPLE'], projectRoles: { productIntake: [], technicalDelivery: ['SAMPLE'], commitments: [] },
  teams: [{ id: 'team-1', name: 'Platform' }],
  teamAssignments: { projects: [{ projectKey: 'SAMPLE', teamId: 'team-1' }], components: [], issueOverrides: [] },
  fieldMappings: [{ semanticKey: 'storyPoints' }],
  workflows: { delivery: { startedStatuses: ['Doing'] }, intake: { statuses: [] }, commitment: { statuses: [] } },
  calendar: { configured: true, workIntervals: [] },
});
const deliverySteps = exports.buildSetupSteps(deliveryConfig, true, 3);
for (const id of ['settings-projects', 'settings-teams', 'settings-fields', 'settings-workflows', 'settings-calendar', 'settings-review', 'import-json-action']) {
  assert.equal(byId(deliverySteps, id).complete, true, `${id} should complete after its configured prerequisites are supplied`);
}
assert.equal(byId(exports.buildSetupSteps(deliveryConfig, false, 0), 'settings-workspace').complete, false);
console.log('First-run setup prerequisite checks passed.');
