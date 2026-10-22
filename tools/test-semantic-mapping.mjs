import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveSemanticValue, semanticHistoryField, transformValue, isIssueDone,
  normalizeWorkflowScope, completionPolicyForProject, lifecycleStatusesForProject, lifecycleRolesForStatus, workflowScopesForProject,
} = require('../electron/semantic-mapping.cjs');
const { normalizeConfig } = require('../electron/configuration.cjs');
const { calculateMetrics } = require('../electron/metrics.cjs');

const config = {
  fieldMappings: [
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_global', projectKey: '', issueTypeId: '', transform: 'number' },
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_project', projectKey: 'ALPHA', issueTypeId: '', transform: 'number' },
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_type', projectKey: '', issueTypeId: '100', transform: 'number' },
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_project_type', projectKey: 'ALPHA', issueTypeId: '100', transform: 'number' },
    { semanticKey: 'loggedTime', providerFieldId: 'customfield_project_type', projectKey: 'BETA', issueTypeId: '100', transform: 'number' },
    { semanticKey: 'loggedTime', providerFieldId: 'customfield_named', providerFieldName: 'Work Duration', projectKey: 'BETA', issueTypeId: '', transform: 'number' },
  ],
};

const alphaStory = {
  key: 'ALPHA-1',
  fields: {
    project: { key: 'ALPHA' }, issuetype: { id: '100' },
    customfield_global: 1, customfield_project: 2, customfield_type: 3, customfield_project_type: 4,
  },
};
const alphaTask = {
  key: 'ALPHA-2',
  fields: {
    project: { key: 'ALPHA' }, issuetype: { id: '200' },
    customfield_global: 1, customfield_project: 2, customfield_type: 3, customfield_project_type: 4,
  },
};
const betaStory = {
  key: 'BETA-1',
  fields: {
    project: { key: 'BETA' }, issuetype: { id: '100' }, customfield_type: 3,
    customfield_project_type: 7, customfield_named: 9,
  },
};

assert.equal(resolveSemanticValue(alphaStory, config, 'storyPoints'), 4,
  'the project and issue-type intersection overrides broader bindings');
assert.equal(resolveSemanticValue(alphaTask, config, 'storyPoints'), 2,
  'a project binding overrides an issue-type-only binding');
assert.equal(resolveSemanticValue(betaStory, config, 'storyPoints'), 3,
  'an issue-type binding applies when no project binding matches');
assert.equal(resolveSemanticValue(betaStory, config, 'loggedTime'), 7,
  'the same provider field ID can mean different things in a different project context');
assert.equal(resolveSemanticValue(betaStory, config, 'storyPoints') !== resolveSemanticValue(betaStory, config, 'loggedTime'), true);

assert.equal(semanticHistoryField({ fieldId: 'customfield_project_type', field: 'Custom value' }, config, alphaStory), 'storyPoints',
  'history field IDs use the matching project and issue-type scope');
assert.equal(semanticHistoryField({ fieldId: 'customfield_project_type', field: 'Custom value' }, config, betaStory), 'loggedTime',
  'history field IDs may resolve to different meanings in another project context');
assert.equal(semanticHistoryField({ field: 'Work Duration' }, config, betaStory), 'loggedTime',
  'configured field-name aliases use issue context');
assert.equal(semanticHistoryField({ fieldId: 'customfield_project', field: 'Story Points' }, config, betaStory), 'Story Points',
  'an out-of-scope configured field ID is not reinterpreted from a familiar display name');
assert.equal(semanticHistoryField({ field: 'status' }, config, betaStory), 'status',
  'generic Jira system-field aliases remain available');
assert.equal(semanticHistoryField({ fieldId: 'customfield_shared', field: 'Conflicting field' }, {
  fieldMappings: [
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_shared', transform: 'number' },
    { semanticKey: 'loggedTime', providerFieldId: 'customfield_shared', transform: 'number' },
  ],
}, alphaStory), 'Conflicting field', 'equally scoped history mappings with different meanings remain unmapped');

const workflowConfig = normalizeConfig({
  projects: ['ALPHA', 'BETA'],
  projectRoles: { technicalDelivery: ['ALPHA'], productIntake: ['BETA'] },
  workflows: {
    delivery: {
      backlogStatuses: ['Open'], readyStatuses: ['Ready'], startedStatuses: ['Doing'], blockedStatuses: ['Blocked'],
      reviewStatuses: ['Review'], completedStatuses: ['Released'], cancelledStatuses: ['Cancelled'],
      completionStatusCategories: ['closed'], resolutionCompletes: false,
    },
    intake: { completedStatuses: ['Approved'], completionStatusCategories: [], resolutionCompletes: false },
  },
});
const policyIssue = (project, status, category = '', resolutiondate = '') => ({
  key: `${project}-1`, fields: { project: { key: project }, status: { name: status, statusCategory: { key: category } }, resolutiondate },
});
assert.equal(isIssueDone(policyIssue('ALPHA', 'Released'), workflowConfig), true, 'configured completion labels count as done');
assert.equal(isIssueDone(policyIssue('ALPHA', 'Closed', 'closed'), workflowConfig), true, 'configured completion categories count as done');
assert.equal(isIssueDone(policyIssue('ALPHA', 'Done', 'done', '2026-01-01'), workflowConfig), false,
  'unselected category and resolution signals do not override a workflow policy');
assert.equal(isIssueDone(policyIssue('BETA', 'Approved'), workflowConfig), true);
assert.equal(isIssueDone(policyIssue('BETA', 'Done', 'done'), workflowConfig), false, 'an empty category list disables implicit Jira Done completion');
assert.deepEqual([...completionPolicyForProject(workflowConfig, 'ALPHA').completionStatusCategories], ['closed']);
assert.deepEqual([...lifecycleStatusesForProject(workflowConfig, 'ALPHA', 'started')], ['doing']);
assert.deepEqual(lifecycleRolesForStatus(workflowConfig, 'ALPHA', 'Doing'), ['started']);
assert.deepEqual(lifecycleRolesForStatus(workflowConfig, 'ALPHA', 'Released'), ['delivered']);

const overlappingWorkflowConfig = normalizeConfig({
  projects: ['MULTI'],
  projectRoles: { technicalDelivery: ['MULTI'], productIntake: ['MULTI'], commitments: ['MULTI'] },
  workflows: {
    delivery: { startedStatuses: ['Building'], completedStatuses: ['Shipped'], completionStatusCategories: ['closed'], resolutionCompletes: false },
    intake: { startedStatuses: ['Triaged'], completedStatuses: ['Accepted'], completionStatusCategories: [], resolutionCompletes: false },
    commitment: { completedStatuses: ['Approved'], completionStatusCategories: ['resolved'], resolutionCompletes: false },
  },
});
const multiIssue = (status, category = '', resolutiondate = '') => policyIssue('MULTI', status, category, resolutiondate);
assert.equal(normalizeWorkflowScope('technicalDelivery'), 'delivery');
assert.equal(normalizeWorkflowScope('__proto__'), '', 'unknown workflow scopes do not resolve through object prototype keys');
assert.deepEqual(workflowScopesForProject(overlappingWorkflowConfig, 'MULTI').sort(), ['commitment', 'delivery', 'intake']);
assert.equal(isIssueDone(multiIssue('Accepted'), overlappingWorkflowConfig, 'intake'), true);
assert.equal(isIssueDone(multiIssue('Accepted'), overlappingWorkflowConfig, 'delivery'), false,
  'an intake completion label does not complete the same project issue for delivery');
assert.equal(isIssueDone(multiIssue('Shipped'), overlappingWorkflowConfig, 'delivery'), true);
assert.equal(isIssueDone(multiIssue('Shipped'), overlappingWorkflowConfig, 'intake'), false,
  'a delivery completion label does not complete the same project issue for intake');
assert.equal(isIssueDone(multiIssue('Any', 'closed'), overlappingWorkflowConfig, 'delivery'), true);
assert.equal(isIssueDone(multiIssue('Any', 'closed'), overlappingWorkflowConfig, 'commitment'), false,
  'category completion is isolated by role');
assert.equal(isIssueDone(multiIssue('Any', 'resolved'), overlappingWorkflowConfig, 'commitment'), true);
assert.equal(isIssueDone(multiIssue('Any', 'indeterminate', '2026-01-01'), overlappingWorkflowConfig, 'intake'), false,
  'resolution completion is independently disabled for intake');
assert.deepEqual(lifecycleRolesForStatus(overlappingWorkflowConfig, 'MULTI', 'Triaged', '', false, 'intake'), ['started']);
assert.deepEqual(lifecycleRolesForStatus(overlappingWorkflowConfig, 'MULTI', 'Triaged', '', false, 'delivery'), []);

for (const value of [null, undefined, '', '   ', 'not-a-number', '0x10', true, [], {}]) {
  assert.equal(transformValue(value, 'number'), null, `invalid or missing numeric values stay null (${String(value)})`);
}
assert.equal(transformValue(0, 'number'), 0, 'numeric zero stays zero');
assert.equal(transformValue('0', 'number'), 0, 'numeric string zero stays zero');
assert.equal(transformValue('-1.25e2', 'number'), -125, 'finite decimal and exponent values are accepted');
assert.equal(transformValue(true, 'boolean'), true);
assert.equal(transformValue('false', 'boolean'), false);
assert.equal(transformValue('0', 'boolean'), false);
assert.equal(transformValue(' 1 ', 'boolean'), true);
assert.equal(transformValue('no', 'boolean'), null, 'unrecognized boolean labels remain unknown');
assert.equal(transformValue('false', 'identity'), 'false', 'identity mappings preserve source values');

function equivalentProfile(fieldPrefix) {
  return normalizeConfig({
    projects: ['ALPHA'],
    projectRoles: { technicalDelivery: ['ALPHA'] },
    teams: [{ id: 'team-sample', name: 'Sample Team', aliases: [] }],
    fieldMappings: [
      { semanticKey: 'storyPoints', providerFieldId: `${fieldPrefix}_points`, projectKey: 'ALPHA', issueTypeId: '100', transform: 'number' },
      { semanticKey: 'epicLink', providerFieldId: `${fieldPrefix}_parent`, projectKey: 'ALPHA', issueTypeId: '100', transform: 'text' },
      { semanticKey: 'team', providerFieldId: `${fieldPrefix}_team`, projectKey: 'ALPHA', issueTypeId: '100', transform: 'option-label' },
      { semanticKey: 'workClassification', providerFieldId: `${fieldPrefix}_work`, projectKey: 'ALPHA', issueTypeId: '100', transform: 'option-label' },
    ],
    workClassifications: [{ id: 'feature', label: 'Feature', aliases: [] }],
    issueTypeClassifications: [{ issueTypeId: '100', classification: 'feature' }],
    workflows: { delivery: { completedStatuses: ['Done'] } },
  });
}

function equivalentIssue(fieldPrefix) {
  return {
    id: '7001', key: 'ALPHA-7',
    fields: {
      project: { key: 'ALPHA' }, issuetype: { id: '100', name: 'Delivery Item' },
      summary: 'Equivalent mapped facts', status: { name: 'Done', statusCategory: { key: 'indeterminate' } },
      assignee: { key: 'person-1', name: 'person-1', displayName: 'Person One' },
      created: '2026-02-01T00:00:00.000Z', updated: '2026-02-02T00:00:00.000Z',
      [`${fieldPrefix}_points`]: '8', [`${fieldPrefix}_parent`]: 'ALPHA-EPIC',
      [`${fieldPrefix}_team`]: { value: 'Sample Team' }, [`${fieldPrefix}_work`]: { value: 'Feature' },
    },
    changelog: { total: 0, startAt: 0, histories: [] },
  };
}

const firstProfileMetrics = calculateMetrics([equivalentIssue('customfield_first')], [], equivalentProfile('customfield_first'));
const secondProfileMetrics = calculateMetrics([equivalentIssue('customfield_second')], [], equivalentProfile('customfield_second'));
const comparableIssue = (metrics) => {
  const row = metrics.issues[0];
  return { points: row.points, epicLink: row.epicLink, team: row.team, workClassification: row.workClassification, isDone: row.isDone, issueClass: row.issueClass };
};
assert.deepEqual(comparableIssue(firstProfileMetrics), comparableIssue(secondProfileMetrics),
  'different Jira custom-field IDs produce equivalent normalized facts and report inputs');
assert.deepEqual(firstProfileMetrics.summary, secondProfileMetrics.summary,
  'equivalent mapped facts produce matching metric summary results across independent profiles');
assert.deepEqual(firstProfileMetrics.quality.fieldCoverage, secondProfileMetrics.quality.fieldCoverage,
  'semantic field coverage remains equivalent when provider field IDs differ');

const coverageConfig = normalizeConfig({
  projects: ['ALPHA', 'BETA'],
  fieldMappings: [
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_alpha_points', projectKey: 'ALPHA', transform: 'number' },
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_beta_points', projectKey: 'BETA', transform: 'number' },
  ],
});
function coverageIssue(project, index, value, includeField = true) {
  const fieldId = project === 'ALPHA' ? 'customfield_alpha_points' : project === 'BETA' ? 'customfield_beta_points' : 'customfield_alpha_points';
  return {
    id: `coverage-${index}`, key: `${project}-${index}`,
    fields: {
      project: { key: project }, issuetype: { id: '100', name: 'Task' },
      status: { name: 'Open', statusCategory: { key: 'indeterminate' } }, created: '2026-02-01T00:00:00.000Z',
      ...(includeField ? { [fieldId]: value } : {}),
    },
    changelog: { total: 0, startAt: 0, histories: [] },
  };
}
const coverageResult = calculateMetrics([
  coverageIssue('ALPHA', 1, 'not numeric'),
  coverageIssue('BETA', 2, null),
  coverageIssue('ALPHA', 3, ''),
  coverageIssue('BETA', 4, []),
  coverageIssue('ALPHA', 5, undefined, false),
  coverageIssue('GAMMA', 6, '8'),
], [], coverageConfig);
assert.deepEqual(coverageResult.quality.fieldCoverage.storyPoints, {
  returned: 4, missing: 1, null: 1, emptyArray: 1, emptyString: 1, present: 2, invalid: 1, unmapped: 1,
}, 'field coverage separates invalid values, null, empty, missing and out-of-scope mappings without double-counting');
assert.ok(coverageResult.quality.findings.some((finding) => finding.code === 'SEMANTIC_FIELD_INVALID' && finding.semanticKey === 'storyPoints' && finding.count === 1),
  'invalid semantic values are visible as a data-quality finding');

const aliasConfig = normalizeConfig({
  projects: ['ALPHA'],
  fieldMappings: [
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_shared', projectKey: 'ALPHA', transform: 'number' },
    { semanticKey: 'loggedTime', providerFieldId: 'customfield_shared', projectKey: 'ALPHA', transform: 'number' },
  ],
});
const aliasResult = calculateMetrics([{
  id: 'alias-1', key: 'ALPHA-8',
  fields: { project: { key: 'ALPHA' }, issuetype: { id: '100' }, customfield_shared: '8' },
}], [], aliasConfig);
assert.ok(aliasResult.quality.findings.some((finding) => finding.code === 'SEMANTIC_FIELD_ALIAS'
  && finding.count === 1 && finding.semanticKeys.includes('storyPoints') && finding.semanticKeys.includes('loggedTime')),
'a source field used for multiple active semantic meanings is surfaced for review');

console.log('Semantic mapping scope and null-preservation checks passed.');
