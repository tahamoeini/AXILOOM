import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import configuration from '../electron/configuration.cjs';
import database from '../electron/database.cjs';

const { DEFAULT_CONFIG, normalizeConfig, validateConfig, configurationFingerprint, sourceIdentityKey } = configuration;
const resourceLimits = (await import('../shared/resource-limits.json', { with: { type: 'json' } })).default.configuration;

assert.deepEqual(DEFAULT_CONFIG.projects, []);
assert.deepEqual(DEFAULT_CONFIG.teams, []);
assert.deepEqual(DEFAULT_CONFIG.fieldMappings, []);
assert.equal(DEFAULT_CONFIG.calendar.configured, false);
assert.equal(DEFAULT_CONFIG.modules.businessSprint, false);
assert.throws(() => validateConfig({ teams: Array.from({ length: resourceLimits.maxTeams + 1 }, (_, index) => ({ id: `team-${index}`, name: `Team ${index}` })) }), /exceeds its .* item limit/,
  'configuration collections are bounded before normalization');
assert.throws(() => validateConfig({ deeplyNested: Array.from({ length: resourceLimits.maxDepth + 2 }, () => ({})).reduceRight((value) => [value], null) }), /nesting safety limit/,
  'arbitrary configuration nesting is bounded before recursive processing');
assert.ok(DEFAULT_CONFIG.recordTemplates.some((template) => template.kind === 'product'));
assert.throws(() => validateConfig({ schemaVersion: 5 }), /newer than the supported version 4/,
  'profiles from a newer schema must fail instead of being downgraded');
assert.throws(() => validateConfig({ schemaVersion: 1.5 }), /non-negative integer/,
  'fractional schema versions must fail validation');
assert.throws(() => validateConfig({ schemaVersion: '1' }), /non-negative integer/,
  'string schema versions must fail validation');
assert.throws(() => validateConfig({ schemaVersion: null }), /non-negative integer/,
  'null schema versions must fail validation');
assert.throws(() => validateConfig({ schemaVersion: 'unknown' }), /non-negative integer/,
  'nonnumeric schema versions must fail validation');

const profile = validateConfig({
  schemaVersion: 1,
  organization: { name: 'Example Studio', locale: 'en-GB', timeZone: 'Europe/Berlin' },
  workspaceName: 'Delivery workspace',
  jiraUrl: 'https://jira.example.test/context',
  projects: ['IDEAS', 'PLATFORM'],
  projectRoles: { productIntake: ['IDEAS'], technicalDelivery: ['PLATFORM'] },
  teams: [{ id: 'team-platform', name: 'Platform', aliases: ['Core'] }],
  boardRoutes: [{ boardId: '42', teamId: 'team-platform' }],
  fieldMappings: [
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_12345', projectKey: 'PLATFORM', transform: 'number' },
    { semanticKey: 'sprint', providerFieldId: 'customfield_12346', projectKey: 'PLATFORM', transform: 'id-list' },
  ],
  workflows: { delivery: { completedStatuses: ['Completed'], startedStatuses: ['Developing'] } },
  calendar: { configured: true, timeZone: 'Europe/Berlin', workingDays: [1, 2, 3, 4, 5], hoursPerDay: 7.5, holidays: ['2026-12-25'] },
  modules: { delivery: true, portfolio: true },
});

assert.equal(profile.schemaVersion, 4, 'version 1 profiles migrate with private network access, current calendar rules, and typed record templates');
assert.deepEqual(profile.sourceInstance.networkAccess, { mode: 'private', approvedAddresses: [] });
assert.equal(profile.boardRoutes[0].team, 'Platform');
assert.equal(profile.boardRoutes[0].activeFrom, '', 'legacy board routes remain open-ended after normalization');
assert.equal(profile.fieldMappings[0].providerFieldId, 'customfield_12345');
assert.deepEqual(profile.projectRoles.productIntake, ['IDEAS']);
assert.equal(profile.calendar.timeZone, 'Europe/Berlin');
const customRecordProfile = validateConfig({
  recordTemplates: [
    { kind: 'initiative', label: 'Program', fields: [{ key: 'status', label: 'Stage', type: 'enum', options: ['Idea', 'Complete'] }] },
    { kind: 'portfolio_item', label: 'Portfolio item', group: 'strategy', fields: [{ key: 'owner', label: 'Owner', type: 'text', required: true }] },
  ],
});
assert.equal(customRecordProfile.recordTemplates.find((template) => template.kind === 'initiative').label, 'Program');
assert.deepEqual(customRecordProfile.recordTemplates.find((template) => template.kind === 'initiative').fields.find((field) => field.key === 'status').options, ['Idea', 'Complete']);
assert.ok(customRecordProfile.recordTemplates.find((template) => template.kind === 'portfolio_item')?.enabled);
assert.throws(() => validateConfig({ recordTemplates: [{ kind: 'scripted', label: 'Unsafe', fields: [{ key: 'value', label: 'Value', type: 'javascript', required: false }] }] }), /Unsupported field type/);
assert.throws(() => validateConfig({ recordTemplates: [{ kind: 'broken', label: 'Broken', fields: [{ key: 'stage', label: 'Stage', type: 'enum', options: [] }] }] }), /needs at least one option/);
assert.throws(() => validateConfig({ recordTemplates: [{ kind: 'broken', label: 'Broken', fields: [{ key: 'parent', label: 'Parent', type: 'recordRef', referenceKinds: ['missing'] }] }] }), /targets unknown kind/);
const migratedCapacityProfile = validateConfig({
  schemaVersion: 2,
  teams: [{ id: 'team-legacy', name: 'Legacy Team', aliases: [] }],
  capacityOverrides: [{ team: 'Legacy Team', sprintId: '301', assigneeKey: 'person-1', assignee: 'Person One', overrideWorkingDays: null, allocation: 0.5 }],
});
assert.deepEqual(migratedCapacityProfile.capacityOverrides[0], {
  teamId: 'team-legacy', sprintId: '301', assigneeKey: 'person-1', assignee: 'Person One',
  activeFrom: '', activeTo: '', overrideWorkingDays: null, allocation: 0.5,
}, 'version 2 team-name capacity overrides migrate to stable team IDs');
const migratedV1CapacityProfile = validateConfig({
  schemaVersion: 1,
  capacityOverrides: [{ team: 'Archived Operations', sprintId: '302', assigneeKey: 'person-2', assignee: 'Person Two', overrideWorkingDays: 4, allocation: 0.75 }],
});
assert.equal(migratedV1CapacityProfile.capacityOverrides[0].teamId, migratedV1CapacityProfile.teams[0].id,
  'version 1 capacity override labels receive a stable team ID when no team record exists');
assert.equal(migratedV1CapacityProfile.teams[0].name, 'Archived Operations');
const effectiveCapacityProfile = validateConfig({
  teams: [{ id: 'team-calendar', name: 'Calendar Team', aliases: [] }],
  calendar: { configured: true, timeZone: 'Europe/Berlin', workingDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [], workIntervals: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] },
  capacityOverrides: [{ teamId: 'team-calendar', sprintId: '', assigneeKey: 'person-1', assignee: 'Person One', activeFrom: '2026-01-01', activeTo: '2026-06-30', overrideWorkingDays: null, allocation: 0.75 }],
});
assert.equal(effectiveCapacityProfile.capacityOverrides[0].activeTo, '2026-06-30');
assert.throws(() => validateConfig({
  teams: [{ id: 'team-calendar', name: 'Calendar Team', aliases: [] }],
  calendar: { configured: true, timeZone: 'UTC', workingDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [], workIntervals: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '17:00' }] },
}), /must not overlap on the same weekday/);
assert.throws(() => validateConfig({ calendar: { workIntervals: [null] } }), /must be objects/);
assert.throws(() => validateConfig({ capacityOverrides: [null] }), /must be objects/);
assert.notEqual(configurationFingerprint(profile), configurationFingerprint({ ...profile, organization: { ...profile.organization, name: 'Another Studio' } }));
assert.notEqual(configurationFingerprint(profile), configurationFingerprint({ ...profile, sourceInstance: { ...profile.sourceInstance, networkAccess: { mode: 'public-pinned', approvedAddresses: ['8.8.8.8'] } } }));
assert.equal(sourceIdentityKey(profile), sourceIdentityKey({ ...profile, organization: { ...profile.organization, name: 'Another Studio' } }));
assert.equal(sourceIdentityKey(profile), sourceIdentityKey({ ...profile, sourceInstance: { ...profile.sourceInstance, networkAccess: { mode: 'public-pinned', approvedAddresses: ['8.8.8.8'] } } }), 'network access policy does not change source identity');
assert.notEqual(sourceIdentityKey(profile), sourceIdentityKey({ ...profile, jiraUrl: 'https://jira-secondary.example.test/context' }));

const migrated = normalizeConfig({
  projects: ['REQUESTS', 'DELIVERY'],
  boardRoutes: [{ boardId: '9', team: 'Research' }],
  doneStatuses: ['Finished'],
});
assert.equal(migrated.migrationStatus, 'review-required');
assert.deepEqual(migrated.projects, ['REQUESTS', 'DELIVERY']);
assert.equal(migrated.teams[0].name, 'Research');
assert.deepEqual(migrated.workflows.delivery.completedStatuses, ['Finished']);
assert.deepEqual(migrated.fieldMappings, []);
assert.equal(migrated.calendar.configured, false);
const workflowProfile = validateConfig({
  projects: ['PLATFORM'],
  projectRoles: { technicalDelivery: ['PLATFORM'] },
  workflows: { delivery: {
    startedStatuses: ['In Progress'], blockedStatuses: ['Blocked'], completionStatusCategories: ['closed'], resolutionCompletes: false,
  } },
});
assert.equal(workflowProfile.workflows.delivery.resolutionCompletes, false, 'an explicit resolution policy survives normalization');
assert.deepEqual(workflowProfile.workflows.delivery.completionStatusCategories, ['closed']);
assert.throws(() => normalizeConfig({ workflows: { delivery: { resolutionCompletes: 'false' } } }), /must be boolean/,
  'invalid resolution policy values must not silently fall back to true');

assert.throws(() => validateConfig({ projects: ['BAD KEY'] }), /Invalid project key/);
assert.throws(() => validateConfig({ jiraUrl: 'http://jira.example.test' }), /HTTPS/);
assert.throws(() => validateConfig({ jiraUrl: 'https://jira.example.test', sourceInstance: { provider: 'jira-datacenter', networkAccess: { mode: 'public-pinned', approvedAddresses: [] } } }), /requires at least one administrator-approved/);
assert.throws(() => validateConfig({ jiraUrl: 'https://jira.example.test', sourceInstance: { provider: 'jira-datacenter', networkAccess: { mode: 'public-pinned', approvedAddresses: ['127.0.0.1'] } } }), /globally routable IPv4/);
assert.throws(() => validateConfig({ jiraUrl: 'https://jira.example.test', sourceInstance: { provider: 'jira-datacenter', networkAccess: { mode: 'public-pinned', approvedAddresses: ['198.51.100.7'] } } }), /globally routable IPv4/);
const pinnedPublicProfile = validateConfig({ jiraUrl: 'https://jira.example.test', sourceInstance: { provider: 'jira-datacenter', networkAccess: { mode: 'public-pinned', approvedAddresses: ['8.8.8.8'] } } });
assert.deepEqual(pinnedPublicProfile.sourceInstance.networkAccess.approvedAddresses, ['8.8.8.8']);
assert.throws(() => validateConfig({ sourceInstance: { id: 'source-a', provider: 'jira-datacenter', endpoint: 'https://user:secret@jira.example.test' } }), /Credentials must not be embedded/);
assert.throws(() => validateConfig({ sourceInstance: { id: 'source-a', provider: 'jira-datacenter', endpoint: 'https://jira.example.test?token=secret' } }), /query or fragment/);
assert.throws(() => validateConfig({ projects: ['OPS'], fieldMappings: [{ semanticKey: 'storyPoints', providerFieldId: '$.fields.inject' }] }), /Invalid provider field ID/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'A' }], boardRoutes: [{ boardId: '42', teamId: 'missing' }] }), /unknown team/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'North', aliases: ['Shared'] }, { id: 'team-b', name: 'South', aliases: ['shared'] }] }), /Team label .* is ambiguous/);
assert.doesNotThrow(() => validateConfig({ teams: [{ id: 'team-a', name: 'North', aliases: ['north'] }, { id: 'team-b', name: 'South' }] }), 'case-insensitive duplicate aliases within one team are harmless');
const organizationProfile = validateConfig({
  projects: ['ALPHA'],
  teams: [
    { id: 'division-product', name: 'Product' },
    { id: 'team-north', name: 'North', parentTeamId: 'division-product', activeFrom: '2026-01-01', activeTo: '2026-12-31' },
  ],
  teamAssignments: {
    projects: [{ projectKey: 'ALPHA', teamId: 'team-north', activeFrom: '2026-02-01', activeTo: '2026-06-30' }],
    components: [{ projectKey: 'ALPHA', componentId: '501', componentName: 'Frontend', teamId: 'team-north' }],
    issueOverrides: [{ issueKey: 'ALPHA-10', teamId: 'team-north' }],
  },
});
assert.equal(organizationProfile.teams[1].parentTeamId, 'division-product');
assert.equal(organizationProfile.teamAssignments.projects[0].teamId, 'team-north');
assert.equal(organizationProfile.teamAssignments.issueOverrides[0].issueKey, 'ALPHA-10');
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'A', parentTeamId: 'team-b' }, { id: 'team-b', name: 'B', parentTeamId: 'team-a' }] }), /hierarchy contains a cycle/);
const datedRoutes = validateConfig({
  projects: ['ALPHA'],
  teams: [{ id: 'team-a', name: 'A' }, { id: 'team-b', name: 'B' }],
  boardRoutes: [
    { boardId: '42', teamId: 'team-a', activeTo: '2026-03-31' },
    { boardId: '42', teamId: 'team-b', activeFrom: '2026-04-01' },
  ],
});
assert.equal(datedRoutes.boardRoutes.length, 2, 'a board can move between teams using non-overlapping UTC intervals');
assert.throws(() => validateConfig({
  projects: ['ALPHA'], teams: [{ id: 'team-a', name: 'A' }, { id: 'team-b', name: 'B' }],
  boardRoutes: [
    { boardId: '42', teamId: 'team-a', activeTo: '2026-04-01' },
    { boardId: '42', teamId: 'team-b', activeFrom: '2026-04-01' },
  ],
}), /overlapping effective dates/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'A', activeFrom: '2026-02-30' }] }), /valid ISO date/);
assert.throws(() => validateConfig({ projects: ['ALPHA'], teams: [{ id: 'team-a', name: 'A' }, { id: 'team-b', name: 'B' }], teamAssignments: { projects: [
  { projectKey: 'ALPHA', teamId: 'team-a', activeFrom: '2026-01-01', activeTo: '2026-03-31' },
  { projectKey: 'ALPHA', teamId: 'team-b', activeFrom: '2026-03-01', activeTo: '2026-06-30' },
] } }), /overlapping effective dates/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'A' }], teamAssignments: { issueOverrides: [{ issueKey: 'unknown', teamId: 'team-a' }] } }), /Invalid issue key/);
const projectAttributedDelivery = validateConfig({
  projects: ['ALPHA'], projectRoles: { technicalDelivery: ['ALPHA'] },
  teams: [{ id: 'team-alpha', name: 'Alpha' }],
  teamAssignments: { projects: [{ projectKey: 'ALPHA', teamId: 'team-alpha' }] },
  fieldMappings: [{ semanticKey: 'sprint', providerFieldId: 'customfield_sprints', projectKey: 'ALPHA', transform: 'id-list' }],
  modules: { delivery: true },
});
assert.equal(projectAttributedDelivery.boardRoutes.length, 0, 'delivery can be configured with project attribution and no board route');
const projectAttributedCommitments = validateConfig({
  projects: ['ALPHA'], projectRoles: { commitments: ['ALPHA'] },
  teams: [{ id: 'team-alpha', name: 'Alpha' }],
  teamAssignments: { projects: [{ projectKey: 'ALPHA', teamId: 'team-alpha' }] },
  fieldMappings: [
    { semanticKey: 'storyPoints', providerFieldId: 'customfield_points', projectKey: 'ALPHA', transform: 'number' },
    { semanticKey: 'sprint', providerFieldId: 'customfield_sprints', projectKey: 'ALPHA', transform: 'id-list' },
  ],
  workflows: { commitment: { entryStatuses: ['Committed'] } },
  modules: { commitments: true, businessSprint: true },
});
assert.equal(projectAttributedCommitments.modules.businessSprint, true, 'sprint commitments can use a project team default without a board route');
assert.throws(() => validateConfig({ calendar: { timeZone: 'Unknown/Zone' } }), /Unknown time zone/);
assert.throws(() => validateConfig({ calendar: { configured: true, workingDays: [] } }), /at least one working day/);

const workspaceDirectory = path.join(os.tmpdir(), `axiloom-configuration-${randomUUID()}`);
fs.mkdirSync(workspaceDirectory, { recursive: true });
const workspacePath = path.join(workspaceDirectory, 'workspace.sqlite');
let db = database.openDatabase(workspacePath);
assert.deepEqual(database.getConfig(db).projects, []);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM configuration_revisions').get().count, 1);
const saved = database.saveConfig(db, profile);
assert.equal(saved.configurationRevision, 2);
assert.equal(database.saveConfig(db, saved).configurationRevision, 2, 'saving an unchanged profile must not create another revision');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM configuration_revisions').get().count, 2);
assert.throws(() => database.saveConfig(db, { ...saved, jiraUrl: 'http://insecure.example.test' }), /HTTPS/);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM configuration_revisions').get().count, 2, 'invalid settings must not be persisted');

db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run('jira_pat_encrypted', '"encrypted-fixture"', new Date().toISOString());
db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run('jira:metadata:old-source:field', '[]', new Date().toISOString());
const switched = database.saveConfig(db, {
  ...saved,
  jiraUrl: 'https://jira-secondary.example.test/context',
  sourceInstance: { id: 'source-secondary', provider: 'jira-datacenter', displayName: 'jira-secondary.example.test', endpoint: 'https://jira-secondary.example.test/context' },
});
assert.equal(switched.sourceInstance.id, 'source-secondary');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM settings WHERE key=?').get('jira_pat_encrypted').count, 0,
  'changing the source identity before ingestion clears the previous encrypted credential');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'jira:metadata:%'").get().count, 0,
  'changing the source identity clears metadata cached for the previous endpoint');
assert.equal(database.saveIssue(db, {
  id: 'source-evidence-1', key: 'PLATFORM-1',
  fields: { project: { key: 'PLATFORM' }, issuetype: { id: '1', name: 'Task' }, summary: 'Retained evidence' },
}, 'source-evidence.json', null).status, 'added');
assert.throws(() => database.saveConfig(db, {
  ...switched,
  sourceInstance: { ...switched.sourceInstance, id: 'source-third' },
}), /already contains source evidence/);
assert.equal(database.getConfig(db).sourceInstance.id, 'source-secondary', 'a rejected source rebind leaves the existing identity unchanged');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1, 'a rejected source rebind preserves imported evidence');

const sprintOnlyDb = database.openDatabase(path.join(workspaceDirectory, 'sprint-only.sqlite'));
database.saveConfig(sprintOnlyDb, { ...profile, workspaceName: 'Sprint-only workspace' });
assert.equal(database.saveSprint(sprintOnlyDb, { id: 'sprint-identity-1', originBoardId: '42', name: 'Existing Sprint', state: 'active' }, 'fixture.json', null).status, 'added');
assert.throws(() => database.saveConfig(sprintOnlyDb, { ...profile, jiraUrl: 'https://jira-third.example.test/context' }), /already contains source evidence/,
  'sprint-only evidence also prevents a workspace from being rebound');
sprintOnlyDb.close();

const legacyOfflineDb = database.openDatabase(path.join(workspaceDirectory, 'legacy-offline.sqlite'));
assert.equal(database.saveIssue(legacyOfflineDb, {
  id: 'legacy-offline-issue', key: 'LEGACY-1',
  fields: { project: { key: 'LEGACY' }, issuetype: { id: '1', name: 'Task' }, summary: 'Unidentified legacy import' },
}, 'legacy.json', null).status, 'added');
const legacyOfflineConfig = database.getConfig(legacyOfflineDb);
const boundOfflineConfig = {
  ...legacyOfflineConfig,
  sourceInstance: { ...legacyOfflineConfig.sourceInstance, id: 'source-legacy-offline', displayName: 'Legacy offline source' },
};
assert.throws(() => database.saveConfig(legacyOfflineDb, boundOfflineConfig), /already contains source evidence/,
  'a legacy offline source needs an explicit identity attestation');
const attestedOfflineConfig = database.saveConfig(legacyOfflineDb, boundOfflineConfig, 'offline-source-attested');
assert.equal(attestedOfflineConfig.sourceInstance.id, 'source-legacy-offline');
assert.equal(attestedOfflineConfig.sourceInstance.displayName, 'Legacy offline source');
assert.throws(() => database.saveConfig(legacyOfflineDb, {
  ...attestedOfflineConfig,
  sourceInstance: { ...attestedOfflineConfig.sourceInstance, displayName: 'Another Jira source' },
}), /already contains source evidence/, 'a bound offline source label cannot be changed after evidence exists');
assert.equal(legacyOfflineDb.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1,
  'legacy source identity attestation preserves all previously imported evidence');
legacyOfflineDb.close();

const legacyProfile = { projects: ['IDEAS', 'PLATFORM'], boardRoutes: [{ boardId: '42', team: 'Platform' }], doneStatuses: ['Completed'] };
db.prepare('UPDATE settings SET value_json=? WHERE key=?').run(JSON.stringify(legacyProfile), 'config');
db.prepare('DELETE FROM configuration_revisions').run();
db.close();
db = database.openDatabase(workspacePath);
const legacyMigrated = database.getConfig(db);
assert.equal(legacyMigrated.migrationStatus, 'review-required');
assert.deepEqual(legacyMigrated.projects, ['IDEAS', 'PLATFORM']);
assert.equal(legacyMigrated.teams[0].name, 'Platform');
assert.equal(legacyMigrated.calendar.configured, false);
assert.equal(legacyMigrated.modules.delivery, false);
const migrationRevision = db.prepare('SELECT event_type,source_profile_json FROM configuration_revisions').get();
assert.equal(migrationRevision.event_type, 'legacy-migration');
assert.equal(migrationRevision.source_profile_json, JSON.stringify(legacyProfile));
db.close();
fs.rmSync(workspaceDirectory, { recursive: true, force: true });

console.log('Configuration registry checks passed.');
