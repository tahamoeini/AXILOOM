import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateWorkspace } from './migrate-workspace.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiloom-migration-'));
const sourcePath = path.join(root, 'legacy.sqlite');
const destinationPath = path.join(root, 'migrated.sqlite');
const importedAt = '2026-10-20T12:00:00.000Z';
const rawIssue = `{
  "id": "1001",
  "key": "ALT-1",
  "fields": { "project": { "key": "ALT" }, "issuetype": { "id": "1", "name": "Task" }, "summary": "Preserve this source payload exactly", "updated": "2026-10-20T12:00:00.000Z" }
}`;
const rawSprint = `{
  "id": 12,
  "name": "Synthetic sprint",
  "state": "closed",
  "startDate": "2026-10-01T00:00:00.000Z",
  "endDate": "2026-10-15T00:00:00.000Z"
}`;

function hashSourceDatabase() {
  return createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
}

try {
  const legacy = new DatabaseSync(sourcePath);
  legacy.exec(`PRAGMA journal_mode=DELETE;
    CREATE TABLE settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE jira_issues(
      jira_id TEXT PRIMARY KEY, issue_key TEXT NOT NULL UNIQUE, project_key TEXT, updated_at TEXT,
      raw_json TEXT NOT NULL, source_file TEXT, imported_at TEXT NOT NULL, history_complete INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE jira_sprints(
      sprint_id TEXT PRIMARY KEY, board_id TEXT, team_route TEXT, state TEXT, start_date TEXT, end_date TEXT,
      activated_date TEXT, complete_date TEXT, raw_json TEXT NOT NULL, source_file TEXT, imported_at TEXT NOT NULL
    );
    CREATE TABLE jira_issue_tombstones(issue_key TEXT PRIMARY KEY, jira_id TEXT NOT NULL, deleted_at TEXT NOT NULL, raw_json TEXT NOT NULL);
    CREATE TABLE configuration_revisions(
      revision INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
      event_type TEXT NOT NULL, profile_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE product_records(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
    );
    CREATE TABLE record_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    PRAGMA user_version=1;`);
  legacy.prepare(`INSERT INTO jira_issues(jira_id,issue_key,project_key,updated_at,raw_json,source_file,imported_at,history_complete)
    VALUES(?,?,?,?,?,?,?,?)`).run('1001', 'ALT-1', 'ALT', '2026-10-20T12:00:00.000Z', rawIssue, 'synthetic-issues.json', importedAt, 0);
  legacy.prepare(`INSERT INTO jira_sprints(sprint_id,board_id,team_route,state,start_date,end_date,activated_date,complete_date,raw_json,source_file,imported_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('12', '77', 'team-synthetic', 'closed', '2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z', null, null, rawSprint, 'synthetic-sprints.json', importedAt);
  legacy.prepare(`INSERT INTO product_records(id,kind,title,payload_json,created_at,updated_at,archived_at)
    VALUES(?,?,?,?,?,?,?)`).run('record-1', 'objective', 'Synthetic objective', '{"status":"Active"}', importedAt, importedAt, null);
  legacy.prepare(`INSERT INTO record_events(record_id,event_type,occurred_at,payload_json)
    VALUES(?,?,?,?)`).run('record-1', 'created', importedAt, '{"title":"Synthetic objective"}');
  legacy.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)`)
    .run('synthetic-preference', '{"display":"compact"}', importedAt);
  legacy.prepare(`INSERT INTO jira_issue_tombstones(issue_key,jira_id,deleted_at,raw_json) VALUES(?,?,?,?)`)
    .run('ALT-2', '1002', importedAt, '{"id":"1002","key":"ALT-2"}');
  legacy.prepare(`INSERT INTO configuration_revisions(revision,schema_version,fingerprint,event_type,profile_json,created_at)
    VALUES(?,?,?,?,?,?)`).run(1, 0, 'legacy-fingerprint', 'legacy-import', '{"schemaVersion":0}', importedAt);
  legacy.close();
  const sourceDatabaseSha256Before = hashSourceDatabase();

  const dryRun = await migrateWorkspace({ sourcePath, destinationPath, dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.sourceModified, false);
  assert.equal(dryRun.jiraIssuesVerified, 1);
  assert.equal(dryRun.jiraSprintsVerified, 1);
  assert.equal(fs.existsSync(destinationPath), false);
  assert.equal(fs.existsSync(`${destinationPath}.migration.json`), false);

  const result = await migrateWorkspace({ sourcePath, destinationPath });
  assert.equal(result.sourceSchemaVersion, 1);
  assert.equal(result.destinationSchemaVersion, 8);
  assert.equal(result.destinationConfigSchemaVersion, 2);
  assert.equal(result.preservedEvidenceRowsVerified.product_records, 1);
  assert.equal(result.preservedEvidenceRowsVerified.record_events, 1);
  assert.equal(result.preservedEvidenceRowsVerified.jira_issue_tombstones, 1);
  assert.equal(result.preservedEvidenceRowsVerified.configuration_revisions, 1);
  assert.equal(fs.existsSync(destinationPath), true);
  assert.equal(fs.existsSync(`${destinationPath}.migration.json`), true);

  const migrated = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    assert.equal(migrated.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 8);
    assert.equal(migrated.prepare('SELECT raw_json FROM jira_issue_revisions WHERE jira_id=?').get('1001').raw_json, rawIssue);
    assert.equal(migrated.prepare('SELECT raw_json FROM jira_sprint_revisions WHERE sprint_id=?').get('12').raw_json, rawSprint);
    assert.equal(migrated.prepare('SELECT raw_json FROM jira_issue_tombstones WHERE issue_key=?').get('ALT-2').raw_json, '{"id":"1002","key":"ALT-2"}');
    assert.equal(migrated.prepare('SELECT fingerprint FROM configuration_revisions WHERE revision=1').get().fingerprint, 'legacy-fingerprint');
    assert.equal(migrated.prepare('SELECT payload_json FROM product_records WHERE id=?').get('record-1').payload_json, '{"status":"Active"}');
    assert.equal(migrated.prepare('SELECT value_json FROM settings WHERE key=?').get('synthetic-preference').value_json, '{"display":"compact"}');
  } finally { migrated.close(); }

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    assert.equal(source.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(source.prepare('SELECT raw_json FROM jira_issues WHERE jira_id=?').get('1001').raw_json, rawIssue);
    assert.equal(source.prepare('SELECT raw_json FROM jira_sprints WHERE sprint_id=?').get('12').raw_json, rawSprint);
  } finally { source.close(); }

  await assert.rejects(() => migrateWorkspace({ sourcePath, destinationPath }), /already exists/);
  const manifest = JSON.parse(fs.readFileSync(`${destinationPath}.migration.json`, 'utf8'));
  assert.equal(manifest.sourceModified, false);
  assert.equal(manifest.preservedEvidenceRowsVerified.product_records, 1);
  assert.equal(hashSourceDatabase(), sourceDatabaseSha256Before, 'Migration must not modify the source database file.');
  console.log('Workspace migration dry-run, evidence reconciliation, and no-overwrite checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
