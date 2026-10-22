import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import workspaces from '../electron/workspaces.cjs';
import database from '../electron/database.cjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiloom-workspaces-'));
try {
  let registry = workspaces.loadRegistry(root);
  const defaultWorkspace = workspaces.activeWorkspace(root, registry);
  const firstDb = database.openDatabase(defaultWorkspace.databaseFile);
  database.saveConfig(firstDb, {
    ...database.getConfig(firstDb),
    organization: { name: 'First source organization', locale: 'en-US', timeZone: 'UTC' },
    jiraUrl: 'https://jira-first.example.test',
    projects: ['CORE'],
    sourceInstance: { id: 'source-first', provider: 'jira-datacenter', displayName: 'Jira First', endpoint: 'https://jira-first.example.test' },
  });
  database.saveIssue(firstDb, { id: 'same-id', key: 'CORE-1', fields: { project: { key: 'CORE' }, issuetype: { id: '1', name: 'Task' }, summary: 'First source' } }, 'first.json', null);
  database.saveSprint(firstDb, { id: 'same-sprint-id', originBoardId: '1', name: 'First source sprint', state: 'active' }, 'first.json', null);
  firstDb.close();

  const created = workspaces.addWorkspace(root, registry, 'Second source');
  registry = created.registry;
  workspaces.saveRegistry(root, registry);
  const secondDb = database.openDatabase(created.workspace.databaseFile);
  database.saveConfig(secondDb, {
    ...database.getConfig(secondDb),
    organization: { name: 'Second source organization', locale: 'en-US', timeZone: 'UTC' },
    jiraUrl: 'https://jira-second.example.test',
    projects: ['CORE'],
    sourceInstance: { id: 'source-second', provider: 'jira-datacenter', displayName: 'Jira Second', endpoint: 'https://jira-second.example.test' },
  });
  database.saveIssue(secondDb, { id: 'same-id', key: 'CORE-1', fields: { project: { key: 'CORE' }, issuetype: { id: '1', name: 'Task' }, summary: 'Second source' } }, 'second.json', null);
  database.saveSprint(secondDb, { id: 'same-sprint-id', originBoardId: '1', name: 'Second source sprint', state: 'active' }, 'second.json', null);
  assert.equal(secondDb.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1);
  assert.equal(JSON.parse(secondDb.prepare('SELECT raw_json FROM jira_issues').get().raw_json).fields.summary, 'Second source');
  assert.equal(JSON.parse(secondDb.prepare('SELECT raw_json FROM jira_sprints').get().raw_json).name, 'Second source sprint');
  assert.equal(database.getConfig(secondDb).sourceInstance.id, 'source-second');
  secondDb.close();

  registry = workspaces.activateWorkspace(root, registry, 'default');
  workspaces.saveRegistry(root, registry);
  const reopened = database.openDatabase(workspaces.activeWorkspace(root, registry).databaseFile);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1);
  assert.equal(JSON.parse(reopened.prepare('SELECT raw_json FROM jira_issues').get().raw_json).fields.summary, 'First source');
  assert.equal(JSON.parse(reopened.prepare('SELECT raw_json FROM jira_sprints').get().raw_json).name, 'First source sprint');
  assert.equal(database.getConfig(reopened).sourceInstance.id, 'source-first');
  reopened.close();

  assert.throws(() => workspaces.resolveFolder(root, '..\\outside'), /outside/);
  assert.equal(workspaces.describeRegistry(root, registry).length, 2);
  console.log('Workspace isolation checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
