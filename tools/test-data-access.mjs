import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = require('../electron/database.cjs');
const { calculateMetrics, compactMetricsForCache, publicSnapshot } = require('../electron/metrics.cjs');
const { getBusinessSprintReport, listBusinessSprints } = require('../electron/business-sprint.cjs');
const { getBusinessBoardReport, getCalendarPeriodReport, getDataGeneration, getIssueActivity, getIssueFilterOptions,
  getIssueOverviewStats, getMetricsGeneration, getCachedMetrics, getConfig, listIssues, openDatabase, saveConfig,
  saveIssue, saveLocalIssueLink, saveSprint } = database;

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'axiloom-data-access-'));
const dbPath = path.join(temporaryDirectory, 'workspace.sqlite');
const now = new Date().toISOString();
const history = [
  { id: 'history-1', created: '2026-01-01T12:00:00.000Z', items: [{ field: 'status', fromString: 'Open', toString: 'In Progress' }] },
  { id: 'history-2', created: '2026-01-02T12:00:00.000Z', items: [{ field: 'status', fromString: 'In Progress', toString: 'Accepted' }] },
];

function issue(id, key, project, status, summary, components, assignee, statusCategory = 'indeterminate', resolutionDate = null) {
  return {
    id: String(id), key,
    fields: {
      project: { id: String(100 + id), key: project, name: project },
      issuetype: { id: '3', name: 'Task' }, summary,
      status: { name: status, statusCategory: { key: statusCategory } }, priority: { name: 'Medium' },
      assignee: assignee ? { key: assignee, name: assignee, displayName: assignee } : null,
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-03T00:00:00.000Z', resolutiondate: resolutionDate,
      components: components.map((name) => ({ id: name, name })),
      comment: { total: 1, comments: [{ id: 'comment-1', body: 'retained', created: now }] },
      worklog: { startAt: 0, maxResults: 1, total: 1, worklogs: [{ id: 'worklog-1', timeSpent: '1h' }] },
      customfield_7301: 2, customfield_7302: '', customfield_7303: '', issuelinks: [],
    },
    changelog: { startAt: 0, total: history.length, histories: history },
  };
}

function alternateProfileIssue(id, key, project, status, points, epicKey, team, classification, resolutionDate = null) {
  return {
    id: String(id), key,
    fields: {
      project: { id: `project-${project}`, key: project, name: project },
      issuetype: { id: '9', name: 'Delivery Item' }, summary: `${project} work`,
      status: { name: status, statusCategory: { key: 'indeterminate' } }, priority: { name: 'Medium' },
      assignee: { key: 'person-1', name: 'person-1', displayName: 'Person One' },
      created: '2026-02-01T00:00:00.000Z', updated: '2026-02-03T00:00:00.000Z', resolutiondate: resolutionDate,
      customfield_9401: points, customfield_9402: epicKey, customfield_9405: '',
      customfield_9403: { value: team }, customfield_9404: { value: classification },
    },
    changelog: { startAt: 0, total: 0, histories: [] },
  };
}

function runSnapshotWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(root, 'electron/snapshot-worker.cjs'), { workerData: { dbPath, filters: {} } });
    let result, messageError;
    worker.once('message', (message) => { if (message.type === 'snapshot') result = message.value; else messageError = new Error(message.error || 'Snapshot worker failed.'); });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error('Snapshot worker exited with code ' + code + '.'));
      else if (messageError) reject(messageError);
      else if (!result) reject(new Error('Snapshot worker exited without a snapshot.'));
      else resolve(result);
    });
  });
}

async function main() {
  let db = openDatabase(dbPath);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8, 'new workspace schema must be version 8');
  const config = saveConfig(db, {
    schemaVersion: 1, organization: { name: 'Example Organization', locale: 'en-US', timeZone: 'Europe/Berlin' },
    projects: ['REQUEST', 'BUILD', 'TRACK'],
    projectRoles: { productIntake: ['REQUEST'], technicalDelivery: ['BUILD'], commitments: ['TRACK'] },
    teams: [{ id: 'team-orbit', name: 'Orbit', aliases: ['Orbit Group'] }],
    fieldMappings: [
      { semanticKey: 'storyPoints', providerFieldId: 'customfield_7301', projectKey: 'BUILD', transform: 'number' },
      { semanticKey: 'epicLink', providerFieldId: 'customfield_7302', projectKey: 'BUILD', transform: 'text' },
      { semanticKey: 'sprint', providerFieldId: 'customfield_7303', projectKey: 'BUILD', transform: 'id-list' },
    ],
    workflows: {
      intake: { startedStatuses: ['In Progress'], completedStatuses: ['Accepted'] },
      delivery: { startedStatuses: ['In Progress'], completedStatuses: ['Shipped'], completionStatusCategories: ['closed'], resolutionCompletes: false },
      commitment: { completedStatuses: ['Resolved'] },
    },
    modules: { productIntake: true },
  });
  assert.deepEqual(config.projectRoles.productIntake, ['REQUEST']);

  saveIssue(db, issue(1, 'REQUEST-1', 'REQUEST', 'In Progress', 'Alpha intake', ['Core'], 'alice'));
  saveIssue(db, issue(2, 'REQUEST-2', 'REQUEST', 'Accepted', 'Accepted intake', [], '', 'indeterminate', '2026-01-02T00:00:00.000Z'));
  saveIssue(db, issue(3, 'BUILD-1', 'BUILD', 'Shipped', 'Delivery work', [], 'bob', 'indeterminate'));
  saveIssue(db, issue(4, 'REQUEST-3', 'REQUEST', 'Done', 'Unmapped completion label', [], 'alice', 'indeterminate'));
  saveIssue(db, issue(5, 'TRACK-1', 'TRACK', 'Resolved', 'Commitment work', [], 'alice', 'indeterminate'));
  const cloudAssignedIssue = issue(6, 'REQUEST-4', 'REQUEST', 'In Progress', 'Account ID assignee', [], '', 'indeterminate');
  cloudAssignedIssue.fields.assignee = { accountId: 'account-123', displayName: 'Cloud User' };
  saveIssue(db, cloudAssignedIssue);
  saveIssue(db, issue(7, 'BUILD-2', 'BUILD', 'Shipped', 'Delivery completion', [], 'bob', 'indeterminate'));
  saveIssue(db, issue(8, 'BUILD-3', 'BUILD', 'Closed', 'Category completion', [], 'bob', 'closed'));
  saveIssue(db, issue(9, 'BUILD-4', 'BUILD', 'Done', 'Ignored completion signals', [], 'bob', 'done', '2026-01-03T00:00:00.000Z'));
  saveLocalIssueLink(db, { intakeIssueKey: 'REQUEST-1', deliveryIssueKey: 'BUILD-1', relationship: 'implements', note: 'fixture' });
  db.prepare('INSERT INTO product_records(id,kind,title,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('record-1', 'decision', 'Delivery review', JSON.stringify({ primaryIssueKey: 'REQUEST-1' }), now, now);
  db.prepare('INSERT INTO product_records(id,kind,title,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('objective-1', 'objective', 'Improve delivery flow', JSON.stringify({ primaryIssueKey: 'REQUEST-1' }), now, now);
  db.prepare('INSERT INTO product_records(id,kind,title,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('request-1', 'request', 'Improve intake triage', JSON.stringify({ objectiveId: 'objective-1', primaryIssueKey: 'REQUEST-1' }), now, now);
  db.prepare('INSERT INTO record_events(record_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?)').run('record-1', 'created', now, '{}');

  const initialMetricGeneration = getMetricsGeneration(db);
  const list = listIssues(db, { project: 'REQUEST', query: 'alpha', limit: 1, sortBy: 'key' });
  assert.equal(list.total, 1); assert.equal(list.items[0].key, 'REQUEST-1'); assert.equal(list.hasMore, false);
  assert.deepEqual(getIssueFilterOptions(db, 'REQUEST').projects, ['REQUEST']);
  assert.deepEqual(getIssueFilterOptions(db, 'REQUEST').components, ['Core']);
  const period = getCalendarPeriodReport(db, { projects: ['REQUEST'], from: '2026-01-01', to: '2026-01-31' });
  assert.equal(period.created, 4); assert.equal(period.completed, 1, 'only the configured intake completion status counts');
  const openIntake = listIssues(db, { project: 'REQUEST', done: false, limit: 50 });
  assert.equal(openIntake.total, 3, 'a similarly named but unmapped status remains open');
  assert.ok(openIntake.items.some((item) => item.key === 'REQUEST-3'));
  assert.equal(listIssues(db, { project: 'REQUEST', assignee: 'account-123', limit: 10 }).items[0].assigneeKey, 'account-123');
  assert.deepEqual(listIssues(db, { project: 'REQUEST', assignee: 'unassigned', limit: 10 }).items.map((item) => item.key), ['REQUEST-2']);
  assert.equal(getIssueOverviewStats(db).issuesWithoutAssignee, 1);
  const completedDelivery = listIssues(db, { project: 'BUILD', done: true, limit: 50 });
  const openDelivery = listIssues(db, { project: 'BUILD', done: false, limit: 50 });
  assert.equal(completedDelivery.total, 3, 'configured delivery status labels and status categories count as complete');
  assert.ok(completedDelivery.items.find((item) => item.key === 'BUILD-3').lifecycleRoles.includes('delivered'));
  assert.equal(openDelivery.total, 1, 'disabled category and resolution rules do not count as complete');
  assert.equal(openDelivery.items[0].key, 'BUILD-4');
  assert.ok(listIssues(db, { project: 'REQUEST', limit: 50 }).items.find((item) => item.key === 'REQUEST-1').lifecycleRoles.includes('started'));
  const allIssueRows = listIssues(db, { limit: 50 });
  assert.equal(allIssueRows.doneCount, allIssueRows.items.filter((item) => item.isDone).length, 'list aggregates use the same completion policy as projected issue rows');
  assert.equal(getIssueOverviewStats(db).openCount, allIssueRows.openCount, 'overview and list open counts share the workflow policy');
  const activity = getIssueActivity(db, 'REQUEST-1', 0, 1);
  assert.equal(activity.history.available, 2); assert.equal(activity.history.histories.length, 1); assert.equal(activity.history.hasMore, true);
  db.close();

  const firstSnapshot = await runSnapshotWorker();
  assert.deepEqual(firstSnapshot.issues, [], 'full Jira issue rows must not be transferred in the page snapshot');
  assert.deepEqual(firstSnapshot.business.issues, [], 'intake rows use the paged report API');
  assert.ok(firstSnapshot.records.some((record) => record.id === 'objective-1' && record.kind === 'objective'), 'objective records remain available in the workspace snapshot');
  assert.ok(firstSnapshot.records.some((record) => record.id === 'request-1' && record.payload.objectiveId === 'objective-1'), 'request-to-objective references remain explicit');
  assert.ok(firstSnapshot.links.some((record) => record.recordId === 'request-1'), 'product requests remain visible in issue-link summaries');

  db = openDatabase(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM report_cache').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM metric_cache').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_issue_cache').get().count, 4);
  assert.equal(db.prepare('SELECT substr(payload_json,1,3) AS prefix FROM metric_cache').get().prefix, 'gz:');
  const report = getBusinessBoardReport(db, { query: 'alpha', limit: 1 });
  assert.equal(report.total, 1); assert.equal(report.items[0].key, 'REQUEST-1'); assert.equal(report.aggregates.linkedCount, 1); assert.equal(report.aggregates.total, report.total);

  const rawIssues = db.prepare('SELECT raw_json FROM jira_issues ORDER BY issue_key').all().map((row) => JSON.parse(row.raw_json));
  const sprints = db.prepare('SELECT raw_json FROM jira_sprints ORDER BY start_date').all().map((row) => JSON.parse(row.raw_json));
  const directMetrics = calculateMetrics(rawIssues, sprints, getConfig(db));
  const metricDoneKeys = directMetrics.issues.filter((item) => item.isDone).map((item) => item.key).sort();
  assert.deepEqual(allIssueRows.items.filter((item) => item.isDone).map((item) => item.key).sort(), metricDoneKeys,
    'the SQL issue-list filter and calculated metrics apply identical workflow completion rules');
  assert.ok(directMetrics.quality.findings.some((finding) => finding.code === 'WORKFLOW_STATUS_UNMAPPED'), 'unmapped current workflow labels are visible in data quality');
  assert.ok(directMetrics.quality.findings.some((finding) => finding.code === 'WORKFLOW_HISTORY_STATUS_UNMAPPED'), 'unmapped historical workflow labels are visible in data quality');
  const engineHash = createHash('sha256').update(fs.readFileSync(path.join(root, 'electron/snapshot.cjs')))
    .update(fs.readFileSync(path.join(root, 'electron/metrics.cjs')))
    .update(fs.readFileSync(path.join(root, 'electron/semantic-mapping.cjs')))
    .update(fs.readFileSync(path.join(root, 'electron/team-attribution.cjs')))
    .update(fs.readFileSync(path.join(root, 'electron/database.cjs'))).digest('hex');
  const configHash = createHash('sha256').update(JSON.stringify(getConfig(db))).digest('hex');
  const cachedMetrics = getCachedMetrics(db, getMetricsGeneration(db), new Date().toISOString().slice(0, 10), engineHash, configHash);
  assert.ok(cachedMetrics, 'worker must persist the versioned metrics cache');
  assert.deepEqual(JSON.parse(JSON.stringify(cachedMetrics)), JSON.parse(JSON.stringify(compactMetricsForCache(directMetrics, getConfig(db)))), 'cached metrics preserve calculated output');

  const cachedPayload = db.prepare('SELECT payload_json FROM metric_cache').get().payload_json;
  const previousGeneration = getDataGeneration(db);
  db.prepare('UPDATE product_records SET title=?,updated_at=? WHERE id=?').run('Updated review', new Date().toISOString(), 'record-1');
  assert.equal(getMetricsGeneration(db), initialMetricGeneration, 'product-record edits must not invalidate Jira metric calculations');
  assert.ok(getDataGeneration(db) > previousGeneration, 'product-record edits must invalidate workspace snapshots');
  db.close();

  const refreshed = await runSnapshotWorker();
  assert.deepEqual(refreshed.sprintMetrics, firstSnapshot.sprintMetrics, 'product-record edits must preserve calculated sprint output');
  db = openDatabase(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM metric_cache').get().count, 1);
  assert.equal(db.prepare('SELECT payload_json FROM metric_cache').get().payload_json, cachedPayload);
  const allIntake = getBusinessBoardReport(db, { limit: 50 });
  assert.equal(allIntake.aggregates.total, 4); assert.equal(allIntake.aggregates.openCount, 3); assert.equal(allIntake.aggregates.doneCount, 1);
  assert.equal(allIntake.aggregates.linkedCount, 1);
  assert.ok(allIntake.items.find((item) => item.key === 'REQUEST-1').linkedProducts.some((record) => record.title === 'Updated review'));
  const filteredIntake = getBusinessBoardReport(db, { component: 'Core', status: 'In Progress', limit: 50 });
  assert.equal(filteredIntake.total, 1); assert.equal(filteredIntake.aggregates.withoutOwner, 0);
  const exportPage = getBusinessBoardReport(db, { offset: 1, limit: 1, includeAggregates: false });
  assert.equal(exportPage.items.length, 1); assert.equal(exportPage.aggregates.total, 0, 'later export pages can skip full-set aggregation');
  db.close();

  db = openDatabase(dbPath);
  db.exec('ALTER TABLE business_issue_cache DROP COLUMN issue_type_name; PRAGMA user_version=7;');
  db.close();
  db = openDatabase(dbPath);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
  assert.ok(db.prepare('PRAGMA table_info(business_issue_cache)').all().some((column) => column.name === 'issue_type_name'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_issue_cache').get().count, 4);
  db.close();

  const alternatePath = path.join(temporaryDirectory, 'alternate-profile.sqlite');
  const alternateDb = openDatabase(alternatePath);
  const alternateConfig = saveConfig(alternateDb, {
    schemaVersion: 1, organization: { name: 'Independent Sample', locale: 'fa-IR', timeZone: 'America/Sao_Paulo' },
    projects: ['IDEAS', 'ENGINEERING'],
    projectRoles: { productIntake: ['IDEAS'], technicalDelivery: ['ENGINEERING'] },
    teams: [{ id: 'team-north', name: 'North', aliases: ['NORTH GROUP'] }],
    boardRoutes: [{ boardId: '21', teamId: 'team-north' }],
    fieldMappings: [
      { semanticKey: 'storyPoints', providerFieldId: 'customfield_9401', projectKey: 'ENGINEERING', transform: 'number' },
      { semanticKey: 'epicLink', providerFieldId: 'customfield_9402', projectKey: 'ENGINEERING', transform: 'text' },
      { semanticKey: 'sprint', providerFieldId: 'customfield_9405', projectKey: 'ENGINEERING', transform: 'id-list' },
      { semanticKey: 'team', providerFieldId: 'customfield_9403', projectKey: 'ENGINEERING', transform: 'option-label' },
      { semanticKey: 'workClassification', providerFieldId: 'customfield_9404', projectKey: 'ENGINEERING', transform: 'option-label' },
    ],
    workClassifications: [{ id: 'feature', label: 'Feature' }],
    issueTypeClassifications: [{ issueTypeId: '9', classification: 'delivery-work' }],
    workflows: { intake: { completedStatuses: ['Approved'] }, delivery: { completedStatuses: ['Finished'] } },
    modules: { delivery: true },
  });
  saveIssue(alternateDb, alternateProfileIssue(31, 'IDEAS-1', 'IDEAS', 'Approved', 0, '', 'North', 'Feature', '2026-02-02T00:00:00.000Z'));
  saveIssue(alternateDb, alternateProfileIssue(32, 'ENGINEERING-1', 'ENGINEERING', 'Finished', 13, 'ENGINEERING-9', 'North', 'Feature', '2026-02-02T00:00:00.000Z'));
  const alternateRows = alternateDb.prepare('SELECT raw_json FROM jira_issues ORDER BY issue_key').all().map((row) => JSON.parse(row.raw_json));
  const alternateMetrics = calculateMetrics(alternateRows, [], alternateConfig);
  const alternateDelivery = alternateMetrics.issues.find((row) => row.key === 'ENGINEERING-1');
  assert.equal(alternateDelivery.points, 13, 'a second profile resolves its own story-point field ID');
  assert.equal(alternateDelivery.epicLink, 'ENGINEERING-9', 'a second profile resolves its own parent relationship field');
  assert.equal(alternateDelivery.team, 'North', 'a second profile resolves its own team mapping');
  assert.equal(alternateDelivery.isDone, true, 'a second profile applies its own completion status');
  assert.equal(alternateDelivery.issueClass, 'delivery-work', 'a second profile applies its own issue-type classification');
  assert.equal(getCalendarPeriodReport(alternateDb, { projects: ['IDEAS'], from: '2026-02-01', to: '2026-02-28' }).completed, 1,
    'a second profile applies its own intake workflow');
  alternateDb.close();

  const overlappingPath = path.join(temporaryDirectory, 'overlapping-workflow-profile.sqlite');
  const overlappingDb = openDatabase(overlappingPath);
  const overlappingConfig = saveConfig(overlappingDb, {
    schemaVersion: 1, organization: { name: 'Overlapping Workflow Sample', locale: 'en-US', timeZone: 'UTC' },
    projects: ['MULTI'],
    projectRoles: { productIntake: ['MULTI'], technicalDelivery: ['MULTI'], commitments: ['MULTI'] },
    workflows: {
      intake: { startedStatuses: ['Triaged'], completedStatuses: ['Accepted'], completionStatusCategories: [], resolutionCompletes: false },
      delivery: { startedStatuses: ['Building'], completedStatuses: ['Shipped'], completionStatusCategories: ['closed'], resolutionCompletes: false },
      commitment: { completedStatuses: ['Approved'], completionStatusCategories: ['resolved'], resolutionCompletes: false },
    },
    modules: { productIntake: true, delivery: false, businessSprint: false },
  });
  saveIssue(overlappingDb, issue(51, 'MULTI-1', 'MULTI', 'Accepted', 'Intake completion', [], 'person-1'));
  saveIssue(overlappingDb, issue(52, 'MULTI-2', 'MULTI', 'Shipped', 'Delivery completion', [], 'person-1'));
  saveIssue(overlappingDb, issue(53, 'MULTI-3', 'MULTI', 'Done', 'Delivery category completion', [], 'person-1', 'closed'));
  saveIssue(overlappingDb, issue(54, 'MULTI-4', 'MULTI', 'Approved', 'Commitment completion', [], 'person-1'));
  saveIssue(overlappingDb, issue(55, 'MULTI-5', 'MULTI', 'Done', 'Commitment category completion', [], 'person-1', 'resolved'));
  saveIssue(overlappingDb, issue(56, 'MULTI-6', 'MULTI', 'Done', 'Resolution excluded by each policy', [], 'person-1', 'indeterminate', '2026-01-03T00:00:00.000Z'));
  saveIssue(overlappingDb, issue(57, 'MULTI-7', 'MULTI', 'Triaged', 'Intake lifecycle only', [], 'person-1'));
  const expectedDoneByScope = {
    intake: ['MULTI-1'],
    delivery: ['MULTI-2', 'MULTI-3'],
    commitment: ['MULTI-4', 'MULTI-5'],
  };
  Object.entries(expectedDoneByScope).forEach(([scope, expectedKeys]) => {
    const complete = listIssues(overlappingDb, { project: 'MULTI', workflowScope: scope, done: true, limit: 50 });
    const all = listIssues(overlappingDb, { project: 'MULTI', workflowScope: scope, limit: 50 });
    assert.deepEqual(complete.items.map((row) => row.key).sort(), expectedKeys,
      `${scope} SQL completion filters apply only that role's statuses, categories, and resolution policy`);
    assert.equal(complete.doneCount, expectedKeys.length, `${scope} aggregate count matches its SQL completion filter`);
    assert.equal(all.doneCount, expectedKeys.length, `${scope} unfiltered aggregate uses the same scoped policy`);
    assert.deepEqual(all.items.filter((row) => row.isDone).map((row) => row.key).sort(), expectedKeys,
      `${scope} projected issue completion agrees with the SQL aggregate`);
  });
  const intakeLifecycle = listIssues(overlappingDb, { project: 'MULTI', workflowScope: 'intake', status: 'Triaged', limit: 5 });
  const deliveryLifecycle = listIssues(overlappingDb, { project: 'MULTI', workflowScope: 'delivery', status: 'Triaged', limit: 5 });
  assert.deepEqual(intakeLifecycle.items[0].lifecycleRoles, ['started']);
  assert.deepEqual(deliveryLifecycle.items[0].lifecycleRoles, [], 'role-specific lifecycle labels do not leak across workflows');
  const overlappingRows = overlappingDb.prepare('SELECT raw_json FROM jira_issues ORDER BY issue_key').all().map((row) => JSON.parse(row.raw_json));
  const overlappingMetrics = calculateMetrics(overlappingRows, [], overlappingConfig);
  const multiAccepted = overlappingMetrics.issues.find((row) => row.key === 'MULTI-1');
  assert.deepEqual(multiAccepted.isDoneByScope, { delivery: false, intake: true, commitment: false });
  const overlappingSnapshot = publicSnapshot(overlappingMetrics, [], [], [], {}, [], overlappingConfig);
  assert.equal(overlappingSnapshot.summary.openRequests, 6, 'intake summary uses intake completion even for a project assigned to three roles');
  assert.equal(overlappingSnapshot.summary.openActions, 5, 'commitment summary uses commitment completion on the same project');
  overlappingDb.close();

  const teamConflictConfig = {
    ...alternateConfig,
    teams: [
      { id: 'team-north', name: 'North', aliases: [] },
      { id: 'team-south', name: 'South', aliases: [] },
    ],
    boardRoutes: [{ boardId: '21', teamId: 'team-north', team: 'North' }],
    fieldMappings: [
      ...alternateConfig.fieldMappings.filter((mapping) => mapping.semanticKey !== 'sprint'),
      { semanticKey: 'sprint', providerFieldId: 'customfield_sprints', projectKey: 'ENGINEERING', transform: 'id-list' },
      { semanticKey: 'sprint', providerFieldId: 'customfield_sprints', projectKey: '', transform: 'id-list' },
    ],
  };
  const conflictIssue = alternateProfileIssue(33, 'ENGINEERING-2', 'ENGINEERING', 'Finished', 3, '', 'South', 'Feature', '2026-02-02T00:00:00.000Z');
  conflictIssue.fields.customfield_sprints = ['77'];
  const unmappedIssue = alternateProfileIssue(34, 'ENGINEERING-3', 'ENGINEERING', 'Finished', 5, '', 'Unknown Group', 'Feature', '2026-02-02T00:00:00.000Z');
  unmappedIssue.fields.customfield_sprints = ['77'];
  const routedSprint = {
    id: '77', originBoardId: '21', name: 'Delivery Sprint', state: 'closed',
    startDate: '2026-02-01T00:00:00.000Z', activatedDate: '2026-02-01T00:00:00.000Z',
    endDate: '2026-02-14T00:00:00.000Z', completeDate: '2026-02-14T00:00:00.000Z',
  };
  const conflictMetrics = calculateMetrics([conflictIssue, unmappedIssue], [routedSprint], teamConflictConfig);
  assert.ok(conflictMetrics.quality.findings.some((finding) => finding.code === 'TEAM_ATTRIBUTION_CONFLICT'),
    'a team field that disagrees with its board route is reported as a data-quality conflict');
  assert.ok(conflictMetrics.quality.findings.some((finding) => finding.code === 'TEAM_FIELD_UNMAPPED'),
    'an unknown team field value is reported while the board route remains available');
  assert.equal(conflictMetrics.relations.find((row) => row.issue.key === 'ENGINEERING-2').team, 'South',
    'conflict diagnostics do not silently change the existing configured-field attribution');
  assert.equal(conflictMetrics.relations.find((row) => row.issue.key === 'ENGINEERING-3').team, 'North',
    'an unknown field value falls back to the configured board route');

  const ambiguousConfig = {
    ...teamConflictConfig,
    teams: [
      { id: 'team-north', name: 'North', aliases: ['Shared'] },
      { id: 'team-south', name: 'South', aliases: ['shared'] },
    ],
  };
  const ambiguousIssue = alternateProfileIssue(35, 'ENGINEERING-4', 'ENGINEERING', 'Finished', 2, '', 'Shared', 'Feature', '2026-02-02T00:00:00.000Z');
  ambiguousIssue.fields.customfield_sprints = ['77'];
  const ambiguousMetrics = calculateMetrics([ambiguousIssue], [routedSprint], ambiguousConfig);
  assert.ok(ambiguousMetrics.quality.findings.some((finding) => finding.code === 'TEAM_FIELD_AMBIGUOUS'),
    'ambiguous legacy team aliases are reported defensively');
  assert.equal(ambiguousMetrics.relations[0].team, 'North', 'ambiguous legacy values fall back to the configured board route');

  const attributionConfig = {
    ...teamConflictConfig,
    teams: [
      { id: 'division-product', name: 'Product', aliases: [] },
      { id: 'team-north', name: 'North', aliases: [], parentTeamId: 'division-product', activeFrom: '2026-01-01', activeTo: '2026-12-31' },
      { id: 'team-south', name: 'South', aliases: [], parentTeamId: 'division-product', activeFrom: '2026-01-01', activeTo: '2026-12-31' },
      { id: 'team-retired', name: 'Retired', aliases: [], activeFrom: '2025-01-01', activeTo: '2026-02-10' },
    ],
    teamAssignments: {
      projects: [{ projectKey: 'ENGINEERING', teamId: 'team-north', activeFrom: '2026-01-01', activeTo: '2026-12-31' }],
      components: [
        { projectKey: 'ENGINEERING', componentId: '501', componentName: 'UI', teamId: 'team-south', activeFrom: '', activeTo: '' },
        { projectKey: 'ENGINEERING', componentId: '502', componentName: 'API', teamId: 'team-north', activeFrom: '', activeTo: '' },
      ],
      issueOverrides: [{ issueKey: 'ENGINEERING-7', teamId: 'team-south', activeFrom: '2026-02-01', activeTo: '2026-03-01' }],
    },
  };
  const unroutedSprint = { ...routedSprint, id: '78', originBoardId: '99', name: 'Unrouted Sprint' };
  const projectIssue = alternateProfileIssue(36, 'ENGINEERING-5', 'ENGINEERING', 'Finished', 2, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  const componentIssue = alternateProfileIssue(37, 'ENGINEERING-6', 'ENGINEERING', 'Finished', 3, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  componentIssue.fields.components = [{ id: '501', name: 'UI' }];
  const overrideIssue = alternateProfileIssue(38, 'ENGINEERING-7', 'ENGINEERING', 'Finished', 5, '', 'North', 'Feature', '2026-02-02T00:00:00.000Z');
  const inactiveFieldIssue = alternateProfileIssue(39, 'ENGINEERING-8', 'ENGINEERING', 'Finished', 1, '', 'Retired', 'Feature', '2026-02-02T00:00:00.000Z');
  const unmappedTeamIssue = alternateProfileIssue(41, 'UNKNOWN-10', 'UNKNOWN', 'Finished', 1, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  [projectIssue, componentIssue, overrideIssue, inactiveFieldIssue, unmappedTeamIssue].forEach((issue) => { issue.fields.customfield_sprints = ['78']; });
  const boardPrecedenceIssue = alternateProfileIssue(40, 'ENGINEERING-9', 'ENGINEERING', 'Finished', 8, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  boardPrecedenceIssue.fields.components = [{ id: '501', name: 'UI' }];
  boardPrecedenceIssue.fields.customfield_sprints = ['77'];
  const attributionMetrics = calculateMetrics([projectIssue, componentIssue, overrideIssue, inactiveFieldIssue, boardPrecedenceIssue, unmappedTeamIssue], [routedSprint, unroutedSprint], attributionConfig);
  const attributionByKey = new Map(attributionMetrics.relations.map((relation) => [relation.issue.key, relation]));
  assert.equal(attributionByKey.get('ENGINEERING-5').team, 'North', 'project defaults attribute issues when no narrower source is available');
  assert.deepEqual(attributionByKey.get('ENGINEERING-5').teamPath, ['Product', 'North'], 'reports retain the configured team hierarchy path');
  assert.equal(attributionByKey.get('ENGINEERING-6').team, 'South', 'component mappings override project defaults');
  assert.equal(attributionByKey.get('ENGINEERING-7').team, 'South', 'active issue overrides take precedence over team fields and project mappings');
  assert.equal(attributionByKey.get('ENGINEERING-8').team, 'North', 'inactive team labels fall back to the next active mapping');
  assert.equal(attributionByKey.get('ENGINEERING-9').team, 'North', 'board routes take precedence over component and project defaults');
  assert.equal(attributionMetrics.summary.unmappedTeamRelationCount, 1, 'team-only exclusions are counted explicitly while universal issue totals retain the issue');
  assert.ok(attributionMetrics.quality.findings.some((finding) => finding.code === 'TEAM_FIELD_INACTIVE'), 'inactive team labels are distinct from unknown labels');
  assert.ok(attributionMetrics.quality.findings.some((finding) => finding.code === 'TEAM_ATTRIBUTION_CONFLICT'), 'disagreeing active sources are exposed as attribution conflicts');
  assert.ok(attributionMetrics.sprintMetrics.some((metric) => metric.team === 'North' && metric.sprintId === '78'), 'project and component attribution enable team metrics for sprints without a board route');
  assert.ok(attributionMetrics.sprintMetrics.some((metric) => metric.teamId === 'team-north' && metric.teamPath.join('/') === 'Product/North'), 'sprint rows retain the stable team identity and hierarchy');
  assert.ok(attributionMetrics.personMetrics.some((metric) => metric.teamId === 'team-north' && metric.assigneeKey === 'person-1'), 'person reports use the same project team attribution');

  const portfolioEpic = alternateProfileIssue(42, 'ENGINEERING-EPIC', 'ENGINEERING', 'Finished', 0, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  portfolioEpic.fields.issuetype = { id: '100', name: 'Epic' };
  portfolioEpic.fields.customfield_9402 = '';
  portfolioEpic.fields.customfield_sprints = [];
  const portfolioChild = alternateProfileIssue(43, 'ENGINEERING-CHILD', 'ENGINEERING', 'Finished', 3, 'ENGINEERING-EPIC', '', 'Feature', '2026-02-02T00:00:00.000Z');
  portfolioChild.fields.customfield_sprints = ['78'];
  const portfolioMetrics = calculateMetrics([portfolioEpic, portfolioChild], [unroutedSprint], attributionConfig);
  assert.deepEqual(portfolioMetrics.epics[0].teamGroups, [{ teamId: 'team-north', team: 'North', issueCount: 1 }],
    'portfolio epics group distinct child issues by the team that had sprint attribution');
  const portfolioSnapshot = publicSnapshot(portfolioMetrics, [], [], [], {}, [], attributionConfig);
  assert.deepEqual(portfolioSnapshot.epics[0].teamGroups, portfolioMetrics.epics[0].teamGroups, 'portfolio team groups reach the renderer snapshot');

  const ambiguousComponentIssue = alternateProfileIssue(47, 'ENGINEERING-47', 'ENGINEERING', 'Finished', 2, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  ambiguousComponentIssue.fields.components = [{ id: '501', name: 'UI' }, { id: '502', name: 'API' }];
  ambiguousComponentIssue.fields.customfield_sprints = ['78'];
  const ambiguousComponentMetrics = calculateMetrics([ambiguousComponentIssue], [unroutedSprint], attributionConfig);
  assert.ok(ambiguousComponentMetrics.quality.findings.some((finding) => finding.code === 'COMPONENT_TEAM_AMBIGUOUS'), 'multi-team component evidence is a distinct attribution-quality state');
  assert.equal(ambiguousComponentMetrics.relations[0].teamId, 'team-north', 'ambiguous component mappings fall through to the project default');

  const datedRouteConfig = {
    ...teamConflictConfig,
    boardRoutes: [
      { boardId: '21', teamId: 'team-south', activeTo: '2026-02-07' },
      { boardId: '21', teamId: 'team-north', activeFrom: '2026-02-08' },
    ],
    teamAssignments: { projects: [], components: [], issueOverrides: [] },
  };
  const earlySprint = { ...routedSprint, id: '76', startDate: '2026-02-01T00:00:00.000Z', activatedDate: '2026-02-01T00:00:00.000Z', endDate: '2026-02-07T00:00:00.000Z', completeDate: '2026-02-07T00:00:00.000Z' };
  const earlyRouteIssue = alternateProfileIssue(44, 'ENGINEERING-ROUTE-1', 'ENGINEERING', 'Finished', 1, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  earlyRouteIssue.key = 'ENGINEERING-44';
  earlyRouteIssue.fields.customfield_sprints = ['76'];
  const lateRouteIssue = alternateProfileIssue(45, 'ENGINEERING-45', 'ENGINEERING', 'Finished', 1, '', '', 'Feature', '2026-02-02T00:00:00.000Z');
  lateRouteIssue.fields.customfield_sprints = ['77'];
  const datedRouteMetrics = calculateMetrics([earlyRouteIssue, lateRouteIssue], [earlySprint, routedSprint], datedRouteConfig);
  assert.equal(datedRouteMetrics.relations.find((relation) => relation.issue.key === 'ENGINEERING-44').teamId, 'team-south', 'board routes use the effective team on the sprint end date');
  assert.equal(datedRouteMetrics.relations.find((relation) => relation.issue.key === 'ENGINEERING-45').teamId, 'team-north', 'a later route interval preserves the next team assignment');

  const businessDb = openDatabase(path.join(temporaryDirectory, 'project-attributed-business.sqlite'));
  saveConfig(businessDb, {
    projects: ['PLAN'], projectRoles: { productIntake: ['PLAN'], technicalDelivery: ['PLAN'], commitments: ['PLAN'] },
    teams: [{ id: 'team-plan', name: 'Plan Team', parentTeamId: '', aliases: [], activeFrom: '', activeTo: '' }],
    teamAssignments: { projects: [{ projectKey: 'PLAN', teamId: 'team-plan', activeFrom: '', activeTo: '' }], components: [], issueOverrides: [] },
    fieldMappings: [
      { semanticKey: 'storyPoints', providerFieldId: 'customfield_points', projectKey: 'PLAN', transform: 'number' },
      { semanticKey: 'sprint', providerFieldId: 'customfield_sprints', projectKey: 'PLAN', transform: 'id-list' },
    ],
    workflows: {
      intake: { completedStatuses: ['Accepted'], completionStatusCategories: [], resolutionCompletes: false },
      delivery: { completedStatuses: [], completionStatusCategories: ['closed'], resolutionCompletes: false },
      commitment: { entryStatuses: ['Committed'], completedStatuses: ['Finished'], completionStatusCategories: ['done'], resolutionCompletes: false, milestones: [] },
    },
    modules: { commitments: true, businessSprint: true },
  });
  saveSprint(businessDb, {
    id: '301', originBoardId: '999', name: 'Planning sprint', state: 'closed',
    startDate: '2026-02-01T00:00:00.000Z', activatedDate: '2026-02-01T00:00:00.000Z',
    endDate: '2026-02-14T00:00:00.000Z', completeDate: '2026-02-14T00:00:00.000Z',
  }, 'synthetic-fixture.json', null);
  const committedIssue = alternateProfileIssue(46, 'PLAN-1', 'PLAN', 'Committed', 8, '', '', 'Feature', null);
  committedIssue.fields.customfield_points = 8;
  committedIssue.fields.customfield_sprints = ['301'];
  committedIssue.changelog = { startAt: 0, total: 0, histories: [] };
  saveIssue(businessDb, committedIssue, 'synthetic-fixture.json', null);
  const categoryCompletedIssue = alternateProfileIssue(48, 'PLAN-2', 'PLAN', 'Done', 5, '', '', 'Feature', null);
  categoryCompletedIssue.fields.status.statusCategory.key = 'done';
  categoryCompletedIssue.fields.customfield_sprints = ['301'];
  categoryCompletedIssue.changelog = { startAt: 0, total: 1, histories: [{ id: 'plan-done', created: '2026-02-08T12:00:00.000Z', items: [{ field: 'status', fromString: 'Committed', toString: 'Done' }] }] };
  saveIssue(businessDb, categoryCompletedIssue, 'synthetic-fixture.json', null);
  const deliveryCategoryIssue = alternateProfileIssue(49, 'PLAN-3', 'PLAN', 'Done', 3, '', '', 'Feature', null);
  deliveryCategoryIssue.fields.status.statusCategory.key = 'closed';
  deliveryCategoryIssue.fields.customfield_sprints = ['301'];
  deliveryCategoryIssue.changelog = { startAt: 0, total: 1, histories: [{ id: 'plan-closed', created: '2026-02-09T12:00:00.000Z', items: [{ field: 'status', fromString: 'Committed', toString: 'Done' }] }] };
  saveIssue(businessDb, deliveryCategoryIssue, 'synthetic-fixture.json', null);
  assert.equal(listBusinessSprints(businessDb).find((sprint) => sprint.id === '301')?.teamRoute, '', 'business sprint discovery includes valid sprints with no board route');
  const businessReport = getBusinessSprintReport(businessDb, { sprintId: '301' });
  const planTeamReport = businessReport.teams.find((team) => team.teamId === 'team-plan');
  assert.equal(planTeamReport?.committedCount, 3, 'business sprint totals use the same project default and stable team ID');
  assert.equal(planTeamReport?.completedCount, 1, 'a configured completion category counts a currently committed issue without inventing a transition timestamp');
  assert.equal(businessReport.items.find((item) => item.key === 'PLAN-2')?.completedInSprint, true);
  assert.equal(businessReport.items.find((item) => item.key === 'PLAN-3')?.completedInSprint, false,
    'delivery-only category completion does not complete a commitment sprint item');
  const planIssues = businessDb.prepare('SELECT raw_json FROM jira_issues ORDER BY issue_key').all().map((row) => JSON.parse(row.raw_json));
  const planSprint = JSON.parse(businessDb.prepare('SELECT raw_json FROM jira_sprints WHERE sprint_id=?').get('301').raw_json);
  const planDeliveryRelations = calculateMetrics(planIssues, [planSprint], getConfig(businessDb)).relations;
  assert.equal(planDeliveryRelations.find((relation) => relation.issue.key === 'PLAN-2')?.completed, false,
    'commitment-only category completion does not complete a delivery sprint relation');
  assert.equal(planDeliveryRelations.find((relation) => relation.issue.key === 'PLAN-3')?.completed, true,
    'delivery completion uses the delivery category configured for a multi-role project');

  const baseMetricConfig = getConfig(businessDb);
  const metricConfig = {
    ...baseMetricConfig,
    fieldMappings: [
      { semanticKey: 'storyPoints', providerFieldId: 'customfield_points', projectKey: 'PLAN', transform: 'number' },
      { semanticKey: 'sprint', providerFieldId: 'customfield_sprints', projectKey: 'PLAN', transform: 'id-list' },
      { semanticKey: 'workClassification', providerFieldId: 'customfield_work_class', projectKey: 'PLAN', transform: 'text' },
    ],
    workClassifications: [
      { id: 'defect', label: 'Defect', aliases: ['Incident'], minimumShare: null, maximumShare: null },
      { id: 'feature', label: 'Feature', aliases: [], minimumShare: null, maximumShare: null },
    ],
    issueTypeClassifications: [
      { issueTypeId: 'type-defect', classification: 'defect' },
      { issueTypeId: 'type-feature', classification: 'feature' },
    ],
    workflows: {
      ...baseMetricConfig.workflows,
      delivery: { ...baseMetricConfig.workflows.delivery, startedStatuses: ['In Progress'], completedStatuses: ['Done'], completionStatusCategories: ['done'], resolutionCompletes: false },
    },
  };
  const metricIssue = (id, issueClass, points, estimateSeconds, timeSpentSeconds, histories) => ({
    id: String(id), key: `PLAN-${id}`,
    fields: {
      project: { id: 'project-plan', key: 'PLAN', name: 'Plan' },
      issuetype: { id: `type-${issueClass}`, name: issueClass === 'defect' ? 'Incident' : 'Capability' },
      summary: `Synthetic ${issueClass}`, status: { name: 'Done', statusCategory: { key: 'done' } },
      assignee: { key: 'person-1', name: 'person-1', displayName: 'Person One' },
      created: '2026-02-01T00:00:00.000Z', updated: '2026-02-10T00:00:00.000Z', resolutiondate: null,
      customfield_points: points, customfield_sprints: ['301'],
      customfield_work_class: issueClass === 'defect' ? 'Incident' : 'Feature',
      timeoriginalestimate: estimateSeconds, timespent: timeSpentSeconds,
    },
    changelog: { startAt: 0, total: histories.length, historyComplete: true, histories },
  });
  const missingTimeAndPoints = metricIssue(60, 'defect', null, 10800, 7200, [
    { id: 'metric-60-status', created: '2026-02-08T12:00:00.000Z', items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
  ]);
  const fullyMappedFeature = metricIssue(61, 'feature', 3, 7200, 3600, [
    { id: 'metric-61-time', created: '2026-02-05T12:00:00.000Z', items: [{ field: 'timespent', from: '0', fromString: '0', to: '3600', toString: '3600' }] },
    { id: 'metric-61-status', created: '2026-02-08T12:00:00.000Z', items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
  ]);
  const unavailableMetrics = calculateMetrics([missingTimeAndPoints], [planSprint], metricConfig);
  const unavailableScope = unavailableMetrics.sprintMetrics[0].scope;
  assert.equal(unavailableScope.scopeSP, null, 'a nonempty scope with no mapped points is unavailable, not zero');
  assert.equal(unavailableScope.completedSP, null, 'completed points remain unavailable when no completed issue has a mapped value');
  assert.equal(unavailableScope.storyPointCoverage, 0);
  assert.equal(unavailableScope.loggedHours, null, 'a cumulative timespent value without a delta cannot stand in for sprint hours');
  assert.equal(unavailableScope.timeDataCoverage, 0);
  assert.equal(unavailableScope.estimateAccuracy, null, 'estimate accuracy is unavailable when no issue has reliable logged-time evidence');
  assert.equal(unavailableScope.issueClassMetrics.defect.loggedHours, null, 'configured issue-class metrics preserve missing time evidence');
  assert.equal(unavailableScope.classificationResults.find((item) => item.id === 'defect').hours, null,
    'classification hours do not convert unavailable time data to zero');

  const mixedMetricScope = calculateMetrics([missingTimeAndPoints, fullyMappedFeature], [planSprint], metricConfig).sprintMetrics[0].scope;
  assert.equal(mixedMetricScope.scopeSP, 3, 'partial totals sum observed points while exposing coverage');
  assert.equal(mixedMetricScope.storyPointCoverage, 0.5);
  assert.equal(mixedMetricScope.loggedHours, 1, 'only rows with reliable changelog deltas contribute to the proxy total');
  assert.equal(mixedMetricScope.timeDataCoverage, 0.5);
  assert.equal(mixedMetricScope.estimateAccuracy, 0.5, 'estimate accuracy compares the same issue rows on both sides');
  assert.equal(mixedMetricScope.estimateAccuracyCoverage, 0.5);
  assert.deepEqual(Object.keys(mixedMetricScope.issueClassMetrics).sort(), ['defect', 'feature'],
    'issue-class metrics use the independent configured taxonomy');
  assert.equal(mixedMetricScope.issueClassMetrics.feature.storyPoints, 3);
  assert.equal(mixedMetricScope.issueClassMetrics.feature.loggedHours, 1);
  assert.equal(mixedMetricScope.issueClassMetrics.defect.storyPoints, null);
  const overrideCalendar = { configured: true, timeZone: 'UTC', workingDays: [1, 2, 3, 4, 5], holidays: [], workIntervals: [], hoursPerDay: 8 };
  const effectiveOverrideConfig = {
    ...metricConfig,
    calendar: overrideCalendar,
    capacityOverrides: [{
      teamId: 'team-plan', sprintId: '', assigneeKey: 'person-1', assignee: 'Person One',
      activeFrom: '2026-01-01', activeTo: '2026-02-14', overrideWorkingDays: 5.5, allocation: 0.5,
    }],
  };
  const effectiveOverrideMetrics = calculateMetrics([fullyMappedFeature], [planSprint], effectiveOverrideConfig);
  assert.equal(effectiveOverrideMetrics.sprintMetrics[0].scope.capacityHours, 22,
    'a stable-team allocation override applies by effective date and fractional working days');
  assert.equal(effectiveOverrideMetrics.personMetrics[0].scope.capacityHours, 22);
  assert.match(effectiveOverrideMetrics.personMetrics[0].scope.capacityEstimateReason, /explicitly configured/);
  const inferredCapacityMetrics = calculateMetrics([fullyMappedFeature], [planSprint], { ...effectiveOverrideConfig, capacityOverrides: [] });
  assert.match(inferredCapacityMetrics.personMetrics[0].scope.capacityEstimateReason, /defaults to 100%/,
    'person reports explain that issue-assignee-derived allocation is only an estimate');
  assert.match(inferredCapacityMetrics.sprintMetrics[0].scope.capacityEstimateReason, /roster is not verified/);
  const expiredOverrideConfig = {
    ...effectiveOverrideConfig,
    capacityOverrides: [{ ...effectiveOverrideConfig.capacityOverrides[0], activeFrom: '2026-03-01', activeTo: '2026-06-30' }],
  };
  assert.equal(calculateMetrics([fullyMappedFeature], [planSprint], expiredOverrideConfig).sprintMetrics[0].scope.capacityHours, 80,
    'expired allocations do not alter earlier sprint capacity');
  const definitions = require('../src/data/metric-definitions.json');
  assert.ok(definitions.every((definition) => definition.formula && definition.caveat && definition.source),
    'each metric definition retains a formula, a caveat, and an evidence source');
  assert.equal(definitions.some((definition) => /\bBug\b|default Done and Review/i.test([definition.title, definition.formula, definition.caveat].join(' '))), false,
    'metric definitions do not impose a Jira issue-type or completion-status taxonomy');

  const calendarConfig = (timeZone, workingDays, holidays = [], workIntervals = []) => ({
    ...baseMetricConfig,
    organization: { ...baseMetricConfig.organization, timeZone },
    teams: [{ id: 'team-calendar', name: 'Calendar Team', aliases: [], parentTeamId: '', activeFrom: '', activeTo: '' }],
    boardRoutes: [{ boardId: '42', teamId: 'team-calendar', team: 'Calendar Team', activeFrom: '', activeTo: '' }],
    calendar: { configured: true, timeZone, workingDays, holidays, workIntervals, hoursPerDay: 8 },
    capacityOverrides: [],
  });
  const calendarSprint = (id, startDate, endDate, activatedDate, completeDate) => ({
    id, name: `Calendar ${id}`, originBoardId: '42', state: 'closed', startDate, endDate, activatedDate, completeDate,
  });
  const calendarMetricsFor = (config, sprint) => calculateMetrics([], [sprint], config).sprintMetrics[0];
  const berlinCalendar = calendarMetricsFor(calendarConfig('Europe/Berlin', [1, 2, 3, 4, 5], ['2026-04-03']), calendarSprint(
    'berlin-dst', '2026-03-27', '2026-04-06', '2026-03-27T00:00:00.000Z', '2026-04-06T23:00:00.000Z',
  ));
  assert.equal(berlinCalendar.workingDays, 6, 'Berlin date-only planned bounds include the end date, cross DST, and exclude the configured holiday');
  assert.equal(berlinCalendar.plannedCapacityHours, 48);

  const tehranCalendar = calendarMetricsFor(calendarConfig('Asia/Tehran', [6, 0, 1, 2, 3, 4], ['2026-03-21']), calendarSprint(
    'tehran-week', '2026-03-20', '2026-03-30', '2026-03-19T20:30:00.000Z', '2026-03-29T20:30:00.000Z',
  ));
  assert.equal(tehranCalendar.workingDays, 8, 'Tehran uses its configured Saturday-through-Thursday week and holiday');

  const losAngelesCalendar = calendarMetricsFor(calendarConfig('America/Los_Angeles', [0, 1, 2, 3, 4], ['2026-03-26']), calendarSprint(
    'los-angeles-partial-week', '2026-03-24', '2026-03-28', '2026-03-24T07:00:00.000Z', '2026-03-28T07:00:00.000Z',
  ));
  assert.equal(losAngelesCalendar.workingDays, 2, 'date-only planned bounds remain local dates west of UTC');

  const intervalCalendar = calendarMetricsFor(calendarConfig('Europe/Berlin', [1, 2, 3, 4, 5], [], [
    { start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' },
  ]), calendarSprint('split-shift', '2026-03-30', '2026-03-30', '2026-03-30T00:00:00.000Z', '2026-03-30T23:00:00.000Z'));
  assert.equal(intervalCalendar.workingDays, 0.875, 'configured split shifts produce a seven-hour working day equivalent');
  assert.equal(intervalCalendar.plannedCapacityHours, 7);

  const springDstShift = calendarMetricsFor(calendarConfig('Europe/Berlin', [0], [], [{ start: '01:30', end: '03:30' }]), calendarSprint(
    'spring-dst-shift', '2026-03-29', '2026-03-29', '2026-03-29T00:00:00.000Z', '2026-03-29T21:59:59.000Z',
  ));
  assert.equal(springDstShift.plannedCapacityHours, 1, 'spring-forward shift overlap uses elapsed hours across the DST gap');
  const fallDstShift = calendarMetricsFor(calendarConfig('Europe/Berlin', [0], [], [{ start: '02:30', end: '03:30' }]), calendarSprint(
    'fall-dst-shift', '2026-10-25', '2026-10-25', '2026-10-25T00:00:00.000Z', '2026-10-25T22:59:59.000Z',
  ));
  assert.equal(fallDstShift.plannedCapacityHours, 2, 'fall-back ambiguous start uses the earlier instant and spans both repeated hours');
  const invalidGapShift = calendarMetricsFor(calendarConfig('Europe/Berlin', [0], [], [{ start: '02:30', end: '03:30' }]), calendarSprint(
    'spring-dst-gap', '2026-03-29', '2026-03-29', '2026-03-29T00:00:00.000Z', '2026-03-29T21:59:59.000Z',
  ));
  assert.equal(invalidGapShift.plannedWorkingDays, null, 'a configured interval inside the spring-forward gap is unavailable');
  assert.match(invalidGapShift.calendarEstimateReason, /invalid local-time boundary/);

  const timestampInterval = calendarMetricsFor(calendarConfig('Europe/Berlin', [1, 2, 3, 4, 5], [], [{ start: '09:00', end: '12:00' }]), calendarSprint(
    'offset-aware-window', '2026-03-30T09:00:00+02:00', '2026-03-30T12:00:00+02:00', '2026-03-30T00:00:00.000Z', '2026-03-30T21:59:59.000Z',
  ));
  assert.equal(timestampInterval.plannedCapacityHours, 3, 'offset-aware timestamps preserve exact half-open interval overlap');

  const partialNoInterval = calendarMetricsFor(calendarConfig('UTC', [1, 2, 3, 4, 5]), calendarSprint(
    'partial-no-shifts', '2026-03-30T12:00:00Z', '2026-03-31T12:00:00Z', '2026-03-30T00:00:00.000Z', '2026-03-31T12:00:00.000Z',
  ));
  assert.equal(partialNoInterval.plannedWorkingDays, 2, 'without intervals, touched partial working dates keep the documented whole-day estimate');
  assert.equal(partialNoInterval.calendarEstimateQuality, 'approximate');

  const ambiguousCalendar = calendarMetricsFor(calendarConfig('Europe/Berlin', [1, 2, 3, 4, 5]), calendarSprint(
    'ambiguous-date', '2026-03-30T09:00:00', '2026-03-31T09:00:00', '2026-03-30T00:00:00.000Z', '2026-03-30T23:00:00.000Z',
  ));
  assert.equal(ambiguousCalendar.plannedWorkingDays, null, 'local timestamp strings without an offset do not silently use the host timezone');
  assert.match(ambiguousCalendar.scope.capacityEstimateReason, /unambiguous instant/);
  const spaceNaiveCalendar = calendarMetricsFor(calendarConfig('Europe/Berlin', [1, 2, 3, 4, 5]), calendarSprint(
    'space-naive-date', '2026-03-30 09:00:00', '2026-03-31 09:00:00', '2026-03-30T00:00:00.000Z', '2026-03-30T23:00:00.000Z',
  ));
  assert.equal(spaceNaiveCalendar.plannedWorkingDays, null, 'space-separated timezone-naive timestamps are unavailable too');
  const impossibleCalendar = calendarMetricsFor(calendarConfig('Europe/Berlin', [1, 2, 3, 4, 5]), calendarSprint(
    'impossible-date', '2026-02-30', '2026-03-02', '2026-03-01T00:00:00.000Z', '2026-03-02T23:00:00.000Z',
  ));
  assert.equal(impossibleCalendar.plannedWorkingDays, null, 'invalid calendar dates do not roll into a different month');
  assert.equal(berlinCalendar.scope.capacityHours, null, 'team capacity remains unavailable without assigned people or overrides');
  assert.match(berlinCalendar.scope.capacityEstimateReason, /No team-member allocation/);
  assert.equal(businessReport.unmapped.count, 0);
  businessDb.close();
}

main().then(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  process.stdout.write('Axiloom data-access regression checks passed.\n');
}).catch((error) => {
  try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch { /* Best-effort cleanup for failed tests. */ }
  console.error(error); process.exitCode = 1;
});
