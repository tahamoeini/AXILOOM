import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import configuration from '../electron/configuration.cjs';
import database from '../electron/database.cjs';

const { DEFAULT_CONFIG, normalizeConfig, validateConfig, configurationFingerprint } = configuration;

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
assert.throws(() => validateConfig({ projects: ['OPS'], fieldMappings: [{ semanticKey: 'storyPoints', providerFieldId: '$.fields.inject' }] }), /Invalid provider field ID/);
assert.throws(() => validateConfig({ teams: [{ id: 'team-a', name: 'A' }], boardRoutes: [{ boardId: '42', teamId: 'missing' }] }), /unknown team/);
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
