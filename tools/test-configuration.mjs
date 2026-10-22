import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import configuration from '../electron/configuration.cjs';
import database from '../electron/database.cjs';

const { DEFAULT_CONFIG, normalizeConfig, validateConfig, configurationFingerprint, sourceIdentityKey } = configuration;

assert.deepEqual(DEFAULT_CONFIG.projects, []);
assert.deepEqual(DEFAULT_CONFIG.teams, []);
assert.deepEqual(DEFAULT_CONFIG.fieldMappings, []);
assert.equal(DEFAULT_CONFIG.calendar.configured, false);
assert.equal(DEFAULT_CONFIG.modules.businessSprint, false);

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

assert.equal(profile.boardRoutes[0].team, 'Platform');
assert.equal(profile.fieldMappings[0].providerFieldId, 'customfield_12345');
assert.deepEqual(profile.projectRoles.productIntake, ['IDEAS']);
assert.equal(profile.calendar.timeZone, 'Europe/Berlin');
assert.notEqual(configurationFingerprint(profile), configurationFingerprint({ ...profile, organization: { ...profile.organization, name: 'Another Studio' } }));
assert.equal(sourceIdentityKey(profile), sourceIdentityKey({ ...profile, organization: { ...profile.organization, name: 'Another Studio' } }));
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

assert.throws(() => validateConfig({ projects: ['BAD KEY'] }), /Invalid project key/);
assert.throws(() => validateConfig({ jiraUrl: 'http://jira.example.test' }), /HTTPS/);
assert.throws(() => validateConfig({ sourceInstance: { id: 'source-a', provider: 'jira-datacenter', endpoint: 'https://user:secret@jira.example.test' } }), /Credentials must not be embedded/);
assert.throws(() => validateConfig({ sourceInstance: { id: 'source-a', provider: 'jira-datacenter', endpoint: 'https://jira.example.test?token=secret' } }), /query or fragment/);
assert.throws(() => validateConfig({ projects: ['OPS'], fieldMappings: [{ semanticKey: 'storyPoints', providerFieldId: '$.fields.inject' }] }), /Invalid provider field ID/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'A' }], boardRoutes: [{ boardId: '42', teamId: 'missing' }] }), /unknown team/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'North', aliases: ['Shared'] }, { id: 'team-b', name: 'South', aliases: ['shared'] }] }), /Team label .* is ambiguous/);
assert.doesNotThrow(() => validateConfig({ teams: [{ id: 'team-a', name: 'North', aliases: ['north'] }, { id: 'team-b', name: 'South' }] }), 'case-insensitive duplicate aliases within one team are harmless');
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
